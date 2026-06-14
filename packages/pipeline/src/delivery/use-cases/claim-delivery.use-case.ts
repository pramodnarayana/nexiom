import { StorageResolverService } from "../../storage-resolver/storage-resolver.service.js";
import { Injectable, Logger, Inject, forwardRef } from "@nestjs/common";
import { IOutboundGatewayPort } from "../../shared/domain.js";
import { DeliveryRetryService } from "../delivery-retry.service.js";
import { sanitizeErrorObject } from "../../utils.js";
import { MAX_DELIVERY_ATTEMPTS } from "../delivery.service.js";
import {
  ConnectionRepositoryPort,
  CONNECTION_REPOSITORY_PORT,
} from "../../shared/ports/connection.repository.port.js";
import {
  OutboundGatewayRepositoryPort,
  OUTBOUND_GATEWAY_REPOSITORY_PORT,
} from "../../shared/ports/outbound-gateway.repository.port.js";

export interface ClaimDeliveryInput {
  traceId: string;
  dataSourceId: string;
  targetConnectionId: string;
  routeId: string;
  hydratedPayload: Record<string, unknown>;
  srcVendorId?: string;
  canonicalType: string;
  srcAppName: string;
  srcTenantId: string;
  start: number;
  writeL6ResultFn: (
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
  ) => Promise<boolean>;
}

export type ClaimDeliveryResult =
  | {
      status: "CLAIMED";
      destSchemaName: string;
      srcSchemaName: string;
      outboundGatewayId: string;
      attemptCount: number;
      tenantId: string;
      targetAppName: string;
      targetTenantId: string;
    }
  | { status: "TERMINATED" }; // For MAX_ATTEMPTS or Duplicates

@Injectable()
export class ClaimDeliveryUseCase {
  private readonly logger = new Logger(ClaimDeliveryUseCase.name);

  constructor(
    private readonly storageResolver: StorageResolverService,
    @Inject(CONNECTION_REPOSITORY_PORT)
    private readonly connectionPort: ConnectionRepositoryPort,
    @Inject(OUTBOUND_GATEWAY_REPOSITORY_PORT)
    private readonly outboundGatewayRepository: OutboundGatewayRepositoryPort,
    @Inject(forwardRef(() => DeliveryRetryService))
    private readonly retryService: DeliveryRetryService,
  ) {}

  async execute(input: ClaimDeliveryInput): Promise<ClaimDeliveryResult> {
    const {
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
      writeL6ResultFn,
    } = input;

    const destSchemaName =
      await this.storageResolver.resolveSchemaName(targetConnectionId);
    const srcSchemaName =
      await this.storageResolver.resolveSchemaName(dataSourceId);

    const connectionMeta = await this.connectionPort.getGlobalConnectionMeta(targetConnectionId);

    if (!connectionMeta) {
      throw new Error(
        `Connection ${targetConnectionId} not found in global DB`,
      );
    }

    const tenantId = connectionMeta.tenantId;

    // ── TX-1: Insert PENDING or fetch existing outbound_gateway ─
    const gatewayRes = await this.outboundGatewayRepository.insertOrFetchPending(
      tenantId,
      destSchemaName,
      {
        traceId,
        routeId,
        dataSourceId: targetConnectionId,
        srcDataSourceId: dataSourceId,
        payload: hydratedPayload,
      },
    );

    const outboundGatewayId = gatewayRes.id;
    const currentAttemptCount = gatewayRes.attempts;
    const currentStatus = gatewayRes.status;

    // ── MAX_ATTEMPTS guard ────────────────────────────────────────────────
    if (currentAttemptCount >= MAX_DELIVERY_ATTEMPTS) {
      this.logger.error(
        {
          event: "l5.max_attempts",
          outboundGatewayId,
          traceId,
          routeId,
          layer: "L5",
          attemptCount: currentAttemptCount,
        },
        "Max delivery attempts exceeded — permanently failing",
      );
      const writeSuccess = await writeL6ResultFn(
        destSchemaName,
        srcSchemaName,
        outboundGatewayId,
        currentAttemptCount,
        dataSourceId,
        traceId,
        routeId,
        null,
        null,
        500,
        "FAIL",
        start,
        undefined,
        canonicalType,
        srcAppName,
        srcTenantId,
        srcVendorId,
        targetConnectionId,
        undefined,
        undefined,
        undefined,
        tenantId
      );
      if (!writeSuccess) {
        this.logger.error(
          {
            event: "l6.write_failed",
            outboundGatewayId,
            traceId,
            routeId,
            layer: "L6",
          },
          "Failed to write L6 FAIL result after max attempts — deferring to SQS for retry",
        );
        throw new Error(
          "Source-side finalization failed after max attempts. Deferring to SQS for retry.",
        );
      }
      return { status: "TERMINATED" };
    }

    let sourceFinalized = false;

    // ── Check if delivery already succeeded AND source-side finalized ─────
    if (currentStatus === "SUCCESS") {
      sourceFinalized = await this.retryService.isSourceFinalized(
        tenantId,
        srcSchemaName,
        traceId,
        routeId,
      );
      if (sourceFinalized) {
        this.logger.debug(
          { event: "l5.skip_success", traceId, routeId, layer: "L5" },
          "Delivery already succeeded and source finalized, skipping duplicate processing",
        );
        return { status: "TERMINATED" };
      } else {
        this.logger.warn(
          {
            event: "l5.partial_success",
            traceId,
            routeId,
            layer: "L5",
          },
          "Delivery succeeded but source-side incomplete — retrying finalization only",
        );

        sourceFinalized = await this.retryService.retrySourceFinalization(
          destSchemaName,
          srcSchemaName,
          outboundGatewayId,
          traceId,
          routeId,
          dataSourceId,
          targetConnectionId,
          "SUCCESS",
          200,
          canonicalType,
          srcAppName,
          srcTenantId,
          srcVendorId,
          start,
          tenantId,
        );

        if (!sourceFinalized) {
          throw new Error(
            "Source-side finalization retry failed. Deferring to SQS for retry.",
          );
        }

        this.logger.log(
          {
            event: "l6.finalization_retry_success",
            traceId,
            routeId,
            layer: "L6",
          },
          "Source-side finalization retry succeeded",
        );
        return { status: "TERMINATED" };
      }
    }

    // ── Check if delivery already failed AND source-side finalized ─────
    if (currentStatus === "FAIL") {
      sourceFinalized = await this.retryService.isSourceFinalized(
        tenantId,
        srcSchemaName,
        traceId,
        routeId,
      );
      if (sourceFinalized) {
        this.logger.debug(
          { event: "l5.skip_fail", traceId, routeId, layer: "L5" },
          "Delivery already failed and source finalized, skipping duplicate processing",
        );
        return { status: "TERMINATED" };
      } else {
        this.logger.error(
          {
            event: "l5.delivery_error",
            traceId,
            routeId,
            err: sanitizeErrorObject(
              new Error("Delivery failed but source-side incomplete"),
            ),
          },
          "L5 routing delivery failed: Delivery failed but source-side incomplete",
        );

        sourceFinalized = await this.retryService.retrySourceFinalization(
          destSchemaName,
          srcSchemaName,
          outboundGatewayId,
          traceId,
          routeId,
          dataSourceId,
          targetConnectionId,
          "FAIL",
          500,
          canonicalType,
          srcAppName,
          srcTenantId,
          srcVendorId,
          start,
          tenantId,
        );

        if (!sourceFinalized) {
          throw new Error(
            "Source-side finalization retry failed. Deferring to SQS for retry.",
          );
        }

        this.logger.log(
          {
            event: "l6.finalization_retry_success",
            traceId,
            routeId,
            layer: "L6",
          },
          "Source-side finalization retry succeeded",
        );
        return { status: "TERMINATED" };
      }
    }

    // ── Resolve target piece using typed dataSources query ─────────────
    const connRows = await this.connectionPort.getTenantConnectionMeta(targetConnectionId, tenantId);

    if (!connRows) {
      throw new Error(`Target connection ${targetConnectionId} not found`);
    }

    const targetAppName = connRows.appName;
    const targetTenantId = connRows.tenantId;

    // ── TX-2: Atomic claim — transition PENDING/RETRY → PROCESSING ────────
    const claimRes = await this.outboundGatewayRepository.claimForProcessing(
      tenantId,
      destSchemaName,
      outboundGatewayId,
    );

    if (!claimRes.claimed) {
      this.logger.warn(
        {
          event: "l5.claim_failed",
          outboundGatewayId,
          traceId,
          layer: "L5",
        },
        "Delivery already claimed or completed by another worker",
      );
      return { status: "TERMINATED" };
    }

    return {
      status: "CLAIMED",
      destSchemaName,
      srcSchemaName,
      outboundGatewayId,
      attemptCount: claimRes.attemptCount,
      tenantId,
      targetAppName,
      targetTenantId,
    };
  }
}
