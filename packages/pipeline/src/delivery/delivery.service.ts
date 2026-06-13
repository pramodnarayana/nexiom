import { StorageResolverService } from "../storage-resolver/storage-resolver.service.js";
import {
  Injectable,
  Inject,
  OnModuleInit,
  OnModuleDestroy,
  Optional,
  Logger,
  forwardRef,
} from "@nestjs/common";
import { QueueService, QueueName } from "@soopa/queue";
import { StorageResolverModule, ApplicationLoaderModule, PipelineHookBrokerService } from "../index.js";
import type { IOutboundDispatcher } from "../shared/interfaces/outbound-dispatcher.interface.js";

import { TokenManagerService } from "@soopa/credentials";

import { SyncLogRepositoryPort, SYNC_LOG_REPOSITORY_PORT } from "../shared/ports/sync-log.repository.port.js";
import { PipelineStateRepositoryPort, PIPELINE_STATE_REPOSITORY_PORT } from "../shared/ports/pipeline-state.repository.port.js";
import { OutboundGatewayRepositoryPort, OUTBOUND_GATEWAY_REPOSITORY_PORT } from "../shared/ports/outbound-gateway.repository.port.js";
import { StitchRepositoryPort, STITCH_REPOSITORY_PORT } from "../shared/ports/stitch.repository.port.js";
import { TransactionManagerPort, TRANSACTION_MANAGER_PORT } from "../shared/ports/transaction-manager.port.js";

import {
  sanitizeError,
  isValidPipelineMessage,
  sanitizeErrorObject,
} from "../utils.js";
import { DeliveryRetryService } from "./delivery-retry.service.js";
import { GemHydrationService } from "./gem-hydration.service.js";
import {
  evaluateDeliveryStatus,
  type DispatchResponse,
} from "../shared/domain.js";
import { ClaimDeliveryUseCase } from "./use-cases/claim-delivery.use-case.js";

/** Maximum number of executeAction attempts before permanently failing. */
export const MAX_DELIVERY_ATTEMPTS = 5;

@Injectable()
export class DeliveryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DeliveryService.name);
  constructor(
    private readonly queueService: QueueService,
    private readonly storageResolver: StorageResolverService,
    @Inject("IOutboundDispatcher")
    private readonly outboundDispatcher: IOutboundDispatcher,
    @Inject(OUTBOUND_GATEWAY_REPOSITORY_PORT)
    private readonly outboundGatewayRepository: OutboundGatewayRepositoryPort,
    @Inject(SYNC_LOG_REPOSITORY_PORT)
    private readonly syncLogRepository: SyncLogRepositoryPort,
    @Inject(PIPELINE_STATE_REPOSITORY_PORT)
    private readonly pipelineStateRepository: PipelineStateRepositoryPort,
    @Inject(STITCH_REPOSITORY_PORT)
    private readonly stitchRepository: StitchRepositoryPort,
    @Inject(TRANSACTION_MANAGER_PORT)
    private readonly transactionManager: TransactionManagerPort,

    @Inject(forwardRef(() => DeliveryRetryService))
    private readonly retryService: DeliveryRetryService,
    private readonly gemService: GemHydrationService,
    private readonly claimDeliveryUseCase: ClaimDeliveryUseCase,
    @Optional() private readonly tokenManagerService?: TokenManagerService,
  ) {}

  onModuleInit() {
    this.queueService.consume(QueueName.DeliveryQueue, async (msg) => {
      await this.processMessage(msg);
    });
  }

  onModuleDestroy() {}

  private async processMessage(rawMsg: unknown): Promise<void> {
    const msg = rawMsg as Record<string, unknown>;

    // ── Poison-pill guard ─────────────────────────────────────────────────────
    if (
      !isValidPipelineMessage(msg, [
        "traceId",
        "srcDataSourceId",
        "destDataSourceId",
        "routeId",
      ]) ||
      !msg.hydratedPayload
    ) {
      this.logger.warn(
        {
          event: "l5.invalid_message",
          layer: "L5",
          msg: JSON.stringify(msg).slice(0, 200),
        },
        "L5: dropping invalid message — missing required fields",
      );
      return;
    }

    const traceId = msg.traceId as string;
    const dataSourceId = msg.srcDataSourceId as string;
    const targetConnectionId = msg.destDataSourceId as string;
    const routeId = msg.routeId as string;
    const hydratedPayload = msg.hydratedPayload as Record<string, unknown>;

    // GEM fields threaded from L4 FanOutService
    const srcVendorId =
      typeof msg.srcVendorId === "string" ? msg.srcVendorId : undefined;
    const canonicalType =
      typeof msg.canonicalType === "string" ? msg.canonicalType : "RAW";
    const srcAppName =
      typeof msg.srcAppName === "string" ? msg.srcAppName : "unknown";
    const srcTenantId =
      typeof msg.srcTenantId === "string" ? msg.srcTenantId : "unknown";
    const start = Date.now();

    this.logger.log(
      {
        event: "l5.started",
        traceId,
        dataSourceId,
        targetConnectionId,
        routeId,
        layer: "L5",
      },
      "L5 Delivery started",
    );

    let outboundGatewayId = "";
    let sourceFinalized = false;

    try {
      const claimResult = await this.claimDeliveryUseCase.execute({
        traceId,
        dataSourceId,
        targetConnectionId,
        routeId,
        hydratedPayload,
        srcVendorId,
        canonicalType,
        srcAppName,
        srcTenantId,
        start,
        writeL6ResultFn: this.writeL6Result.bind(this),
      });

      if (claimResult.status === "TERMINATED") {
        return;
      }

      outboundGatewayId = claimResult.outboundGatewayId;

      const {
        destSchemaName,
        srcSchemaName,
        tenantId,
        targetAppName,
        targetTenantId,
      } = claimResult;

      if (!this.tokenManagerService) {
        throw new Error(
          `TokenManagerService unavailable — cannot resolve credentials for connection ${targetConnectionId} (traceId=${traceId})`,
        );
      }

      const credentials =
        await this.tokenManagerService.getValidCredentials(targetConnectionId);

      const stitch = await this.stitchRepository.findById(tenantId, routeId);
      const targetObject = stitch?.targetObject ?? "";

      // ── Call prepareUpdate hook & piece.executeAction ──────────────────────────────────────────
      let dispatchResp: DispatchResponse | null = null;
      let dispatchError: unknown = null;
      let sentPayload: Record<string, unknown> = hydratedPayload;

      try {
        // The payload from outbound_gateway is already finalized by FanOut's
        // prepareUpdate hook. It contains the exact fields to be sent.
        const resp = await this.outboundDispatcher.dispatch(targetAppName, {
          targetObject,
          payload: hydratedPayload,
          credentials: credentials as unknown as Record<string, unknown>,
        });

        dispatchResp = {
          statusCode: resp.statusCode,
          retry: resp.retry,
          body: resp.body,
          sentPayload: resp.sentPayload,
          entityId: resp.entityId,
        };

        if (resp.sentPayload) {
          sentPayload = resp.sentPayload;
        }
      } catch (error_: unknown) {
        dispatchError = error_;
      }

      const { statusCode, finalStatus, resPayload } = evaluateDeliveryStatus(
        dispatchResp,
        dispatchError,
        sanitizeError,
      );

      // ── TX-3 (L6): Write result, GEM upsert, sync_log ────────────────────
      const destVendorId =
        finalStatus === "SUCCESS" ? dispatchResp?.entityId : undefined;

      sourceFinalized = await this.writeL6Result(
        destSchemaName,
        srcSchemaName,
        outboundGatewayId,
        claimResult.attemptCount,
        dataSourceId,
        traceId,
        routeId,
        resPayload ?? null,
        sentPayload,
        statusCode,
        finalStatus,
        start,
        destVendorId,
        canonicalType,
        srcAppName,
        srcTenantId,
        srcVendorId,
        targetConnectionId,
        targetAppName,
        targetTenantId,
        targetObject,
        tenantId,
      );

      this.logger.log(
        {
          event: `l6.completed`,
          traceId,
          routeId,
          finalStatus,
          sourceFinalized,
          layer: "L6",
        },
        "L6 delivery completed",
      );

      // If it's a RETRY, throw an error to force SQS to redeliver it!
      if (finalStatus === "RETRY") {
        throw new Error(
          `API call failed with retryable error (HTTP ${statusCode}). Deferring to SQS for retry.`,
        );
      }

      // If source finalization failed, throw to trigger SQS retry
      if (finalStatus === "SUCCESS" && !sourceFinalized) {
        throw new Error(
          "Delivery succeeded but source-side finalization failed. Deferring to SQS for retry.",
        );
      }

      // If delivery failed but source-side finalization incomplete, throw to trigger SQS retry
      if (finalStatus === "FAIL" && !sourceFinalized) {
        throw new Error(
          "Delivery failed but source-side finalization failed. Deferring to SQS for retry.",
        );
      }
    } catch (err: unknown) {
      const sanitizedStr = sanitizeError(err);
      this.logger.error(
        {
          event: "l5.error",
          traceId,
          routeId,
          dataSourceId,
          outboundGatewayId,
          layer: "L5",
          err: sanitizeErrorObject(err),
        },
        `DeliveryService encountered an error: ${sanitizedStr}`,
      );
      throw err; // SQS will natively retry
    }
  }

  public async writeL6Result(
    destSchemaName: string,
    srcSchemaName: string,
    outboundGatewayId: string,
    attemptCount: number,
    dataSourceId: string,
    traceId: string,
    routeId: string,
    resPayload: Record<string, unknown> | null,
    sentPayload: Record<string, unknown> | null,
    statusCode: number,
    finalStatus: "SUCCESS" | "FAIL" | "RETRY",
    start: number,
    destVendorId: string | undefined,
    canonicalType: string,
    srcAppName: string,
    srcTenantId: string,
    srcVendorId: string | undefined,
    targetConnectionId: string,
    targetAppName: string | undefined,
    targetTenantId: string | undefined,
    targetObject: string | undefined,
    tenantId: string,
  ): Promise<boolean> {
    // ── Destination Schema Transaction ──────────────────────────────────────
    const replicaUpdate = targetObject
      ? {
          traceId,
          targetObject,
        }
      : undefined;

    await this.outboundGatewayRepository.markResult(
      tenantId,
      destSchemaName,
      outboundGatewayId,
      attemptCount,
      finalStatus,
      statusCode,
      resPayload,
      sentPayload,
      destVendorId,
      replicaUpdate
        ? {
            traceId: replicaUpdate.traceId,
            dataSourceId: targetConnectionId,
            targetObject: replicaUpdate.targetObject,
          }
        : undefined,
    );

    // ── Source Schema Transaction ──────────────────────────────────────────
    let sourceCommitted = false;
    try {
      // ── Write GEM (Control Plane) before source commit succeeds ──────────────
      if (
        finalStatus === "SUCCESS" &&
        srcVendorId &&
        destVendorId &&
        targetAppName &&
        targetTenantId
      ) {
        await this.gemService.writeGemMapping(tenantId, {
          traceId,
          routeId,
          srcAppName,
          dataSourceId,
          srcTenantId,
          canonicalType,
          srcVendorId,
          targetAppName,
          targetConnectionId,
          targetTenantId,
          destVendorId,
        });
      }

      await this.transactionManager.runInTenantTransaction(tenantId, srcSchemaName, async (tx: any) => {
        await this.syncLogRepository.writeSyncLog(
          tenantId,
          srcSchemaName,
          traceId,
          routeId,
          "L6",
          finalStatus === "RETRY" ? "FAIL" : finalStatus,
          Date.now() - start,
          undefined,
          tx
        );

        if (finalStatus !== "RETRY") {
          await this.pipelineStateRepository.releaseSyncLockByTraceId(
            tenantId,
            srcSchemaName,
            traceId,
            tx
          );
        }
      });

      // Only mark as committed after all write operations succeed
      sourceCommitted = true;
    } catch (err) {
      this.logger.error(
        {
          event: "l6.source_commit_failed",
          traceId,
          routeId,
          layer: "L6",
          err: sanitizeError(err),
        },
        "Source schema finalization failed — will retry on next delivery",
      );
      // Do not rethrow — destination already committed, return false to signal partial commit
    }
    return sourceCommitted;
  }
}
