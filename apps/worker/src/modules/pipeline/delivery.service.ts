import {
  Injectable,
  Inject,
  OnModuleInit,
  OnModuleDestroy,
  Optional,
  Logger,
  forwardRef,
} from "@nestjs/common";
import { eq, sql } from "drizzle-orm";
import { QueueService, QueueName } from "@soopa/queue";
import {
  DATABASE_CONNECTION,
  buildTenantSchema,
  assertValidSchemaName,
  integrationStitches,
  dataSources,
} from "@soopa/database";
import type { DrizzleDb } from "@soopa/database";
import { StorageResolverService } from "@soopa/engine";
import { PieceRegistryService } from "@soopa/piece-registry";
import { TokenManagerService } from "@soopa/credentials";
import { RetryableException } from "@soopa/piece-framework";
import { DB_MANAGER } from "@soopa/dbmanager";
import type { DatabaseManager } from "@soopa/dbmanager";

import {
  sanitizeError,
  isValidPipelineMessage,
  sanitizeErrorObject,
} from "../../shared/pipeline.utils.js";
import { DeliveryRetryService } from "./delivery-retry.service.js";
import { GemHydrationService } from "./gem-hydration.service.js";

/** Maximum number of executeAction attempts before permanently failing. */
const MAX_DELIVERY_ATTEMPTS = 5;

@Injectable()
export class DeliveryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DeliveryService.name);
  constructor(
    private readonly queueService: QueueService,
    @Inject(DATABASE_CONNECTION) private readonly globalDb: DrizzleDb,
    private readonly storageResolver: StorageResolverService,
    private readonly pieceRegistry: PieceRegistryService,
    @Inject(DB_MANAGER) private readonly dbManager: DatabaseManager,
    @Inject(forwardRef(() => DeliveryRetryService))
    private readonly retryService: DeliveryRetryService,
    private readonly gemService: GemHydrationService,
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

    let claimed = false;
    let outboundGatewayId = "";

    try {
      const destSchemaName =
        await this.storageResolver.resolveSchemaName(targetConnectionId);
      const srcSchemaName =
        await this.storageResolver.resolveSchemaName(dataSourceId);

      const { outboundGateway } = buildTenantSchema(destSchemaName);

      const connectionMeta = await this.globalDb
        .select({ tenantId: dataSources.tenantId })
        .from(dataSources)
        .where(eq(dataSources.id, targetConnectionId))
        .limit(1)
        .then((rows) => rows[0]);
      if (!connectionMeta) {
        throw new Error(
          `Connection ${targetConnectionId} not found in global DB`,
        );
      }
      const tenantId = connectionMeta.tenantId;
      const tenantDb = await this.dbManager.getTenantDb(tenantId);

      // ── TX-1: Insert PENDING or fetch existing outbound_gateway ─
      let currentAttemptCount = 0;
      let currentStatus = "";
      let sourceFinalized = false;
      await tenantDb.transaction(async (tx) => {
        assertValidSchemaName(destSchemaName);
        await tx.execute(
          sql`SET LOCAL search_path TO ${sql.raw('"' + destSchemaName + '"')}`,
        );

        await tx
          .insert(outboundGateway)
          .values({
            traceId,
            routeId,
            dataSourceId: targetConnectionId,
            srcDataSourceId: dataSourceId,
            payload: hydratedPayload,
            status: "PENDING",
            attempts: 0,
          })
          .onConflictDoNothing({
            target: [outboundGateway.traceId, outboundGateway.routeId],
          })
          .returning({ id: outboundGateway.id });

        const ob = await tx
          .select({
            id: outboundGateway.id,
            attempts: outboundGateway.attempts,
            status: outboundGateway.status,
          })
          .from(outboundGateway)
          .where(
            sql`${outboundGateway.traceId} = ${traceId} AND ${outboundGateway.routeId} = ${routeId}`,
          )
          .limit(1);

        if (!ob.length) throw new Error("Outbound gateway record not found");
        outboundGatewayId = ob[0].id;
        currentAttemptCount = ob[0].attempts ?? 0;
        currentStatus = ob[0].status;
      });

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
        await this.writeL6Result(
          destSchemaName,
          srcSchemaName,
          outboundGatewayId,
          dataSourceId,
          traceId,
          routeId,
          null, // resPayload
          null, // sentPayload (MAX_ATTEMPTS reached, nothing sent)
          500, // statusCode
          "FAIL", // finalStatus
          start,
          undefined, // destVendorId
          canonicalType,
          srcAppName,
          srcTenantId,
          srcVendorId,
          targetConnectionId,
          undefined, // targetAppName
          undefined, // targetTenantId
          undefined, // targetObject
          tenantDb,
        );
        return; // Exit safely, message is acknowledged
      }

      // ── Check if delivery already succeeded AND source-side finalized ─────
      if (currentStatus === "SUCCESS") {
        // Verify source-side finalization completed by checking sync_log
        sourceFinalized = await this.retryService.isSourceFinalized(
          srcSchemaName,
          traceId,
          routeId,
          tenantDb,
        );
        if (sourceFinalized) {
          this.logger.debug(
            { event: "l5.skip_success", traceId, routeId, layer: "L5" },
            "Delivery already succeeded and source finalized, skipping duplicate processing",
          );
          return; // Safely acknowledge duplicate message
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
            tenantDb,
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
          return; // Exit successfully
        }
      }

      // ── Check if delivery already failed AND source-side finalized ─────
      if (currentStatus === "FAIL") {
        // Verify source-side finalization completed by checking sync_log
        sourceFinalized = await this.retryService.isSourceFinalized(
          srcSchemaName,
          traceId,
          routeId,
          tenantDb,
        );
        if (sourceFinalized) {
          this.logger.debug(
            { event: "l5.skip_fail", traceId, routeId, layer: "L5" },
            "Delivery already failed and source finalized, skipping duplicate processing",
          );
          return; // Safely acknowledge duplicate message
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
            `L5 routing delivery failed: Delivery failed but source-side incomplete`,
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
            tenantDb,
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
          return; // Exit successfully
        }
      }

      if (!this.tokenManagerService) {
        throw new Error(
          `TokenManagerService unavailable — cannot resolve credentials for connection ${targetConnectionId} (traceId=${traceId})`,
        );
      }

      const credentials =
        await this.tokenManagerService.getValidCredentials(targetConnectionId);

      // ── Resolve target piece using typed dataSources query ─────────────
      const connRows = await tenantDb
        .select({
          appName: dataSources.appName,
          tenantId: dataSources.tenantId,
          metadata: dataSources.metadata,
        })
        .from(dataSources)
        .where(eq(dataSources.id, targetConnectionId))
        .limit(1);

      if (!connRows.length)
        throw new Error(`Target connection ${targetConnectionId} not found`);
      const targetAppName = connRows[0].appName;
      const targetTenantId = connRows[0].tenantId;

      const piece = this.pieceRegistry.getPiece(targetAppName);
      if (!piece) throw new Error(`Piece ${targetAppName} not registered`);
      if (!piece.executeAction) {
        throw new Error(`Piece ${targetAppName} has no executeAction defined`);
      }

      // ── TX-2: Atomic claim — transition PENDING/RETRY → PROCESSING ────────
      await tenantDb.transaction(async (tx) => {
        assertValidSchemaName(destSchemaName);
        await tx.execute(
          sql`SET LOCAL search_path TO ${sql.raw('"' + destSchemaName + '"')}`,
        );
        const claimRes = await tx
          .update(outboundGateway)
          .set({
            status: "PROCESSING",
            attempts: sql`${outboundGateway.attempts} + 1`,
            updatedAt: sql`NOW()`,
          })
          .where(
            sql`${outboundGateway.id} = ${outboundGatewayId}
              AND (
                ${outboundGateway.status} = 'PENDING'
                OR ${outboundGateway.status} = 'RETRY'
                OR (${outboundGateway.status} = 'PROCESSING'
                    AND ${outboundGateway.updatedAt} <= NOW() - INTERVAL '5 minutes')
              )`,
          )
          .returning({ id: outboundGateway.id });

        if (claimRes.length > 0) claimed = true;
      });

      if (!claimed) {
        this.logger.warn(
          {
            event: "l5.claim_failed",
            outboundGatewayId,
            traceId,
            layer: "L5",
          },
          "Delivery already claimed or completed by another worker",
        );
        return; // Safely acknowledge, SQS will drop the duplicate
      }

      const stitchDocs = await tenantDb
        .select()
        .from(integrationStitches)
        .where(sql`id = ${routeId}`)
        .limit(1);
      const targetObject = stitchDocs[0]?.targetObject ?? "";

      // ── Call prepareUpdate hook & piece.executeAction ──────────────────────────────────────────
      let resPayload: Record<string, unknown> | null = null;
      let respEntityId: string | undefined = undefined;
      // sentPayload tracks the actual payload sent to the vendor. It starts as
      // hydratedPayload (prepared by FanOut) and is overwritten with the piece's
      // resp.sentPayload if the piece performed any internal mutation (e.g. SyncToken retry).
      let sentPayload: Record<string, unknown> = hydratedPayload;
      let statusCode = 500;
      let finalStatus: "SUCCESS" | "FAIL" | "RETRY" = "FAIL";

      try {
        // The payload from outbound_gateway is already finalized by FanOut's
        // prepareUpdate hook. It contains the exact fields to be sent.

        const resp = await piece.executeAction(
          targetObject,
          hydratedPayload,
          credentials as unknown as Record<string, unknown>,
        );
        resPayload = resp.body;
        respEntityId = resp.entityId;
        statusCode = resp.statusCode ?? 200;
        // sentPayload is the exact payload the piece ultimately sent to the vendor.
        // It may differ from hydratedPayload when the piece performs an internal
        // retry (e.g. SyncToken refresh). We persist this back to outbound_gateway
        // so the record reflects truth, not an intermediate prepared state.
        if (resp.sentPayload) {
          sentPayload = resp.sentPayload;
        }

        if (statusCode >= 200 && statusCode < 300) {
          finalStatus = "SUCCESS";
        } else if (resp.retry === true) {
          finalStatus = "RETRY";
        } else {
          finalStatus = "FAIL";
        }
      } catch (error_: unknown) {
        if (error_ instanceof RetryableException) {
          statusCode = error_.statusCode;
          finalStatus = "RETRY";
          resPayload = { error: sanitizeError(error_) };
        } else {
          const errObj = error_ as Record<string, unknown>;
          const isExplicitlyRetryable =
            typeof errObj?.["retryable"] === "boolean"
              ? errObj["retryable"]
              : false;

          statusCode =
            typeof errObj?.["statusCode"] === "number"
              ? errObj["statusCode"]
              : 500;

          if (isExplicitlyRetryable) {
            finalStatus = "RETRY";
          } else {
            finalStatus = "FAIL";
          }

          resPayload = { error: sanitizeError(error_) };
        }
      }

      // ── TX-3 (L6): Write result, GEM upsert, sync_log ────────────────────
      const destVendorId = finalStatus === "SUCCESS" ? respEntityId : undefined;

      sourceFinalized = await this.writeL6Result(
        destSchemaName,
        srcSchemaName,
        outboundGatewayId,
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
        tenantDb,
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
    tenantDb: DrizzleDb,
  ): Promise<boolean> {
    // ── Destination Schema Transaction ──────────────────────────────────────
    await tenantDb.transaction(async (tx) => {
      assertValidSchemaName(destSchemaName);
      await tx.execute(
        sql`SET LOCAL search_path TO ${sql.raw('"' + destSchemaName + '"')}`,
      );

      const { outboundGateway, replicaEntity } =
        buildTenantSchema(destSchemaName);

      await tx
        .update(outboundGateway)
        .set({
          response: resPayload ?? {},
          statusCode,
          status: finalStatus,
          ...(sentPayload && { payload: sentPayload }),
          // Persist destVendorId so it survives partial commits and can be used in retries
          ...(destVendorId && { destVendorId }),
        })
        .where(sql`${outboundGateway.id} = ${outboundGatewayId}`);

      if (
        finalStatus === "SUCCESS" &&
        resPayload &&
        targetObject &&
        destVendorId
      ) {
        await tx
          .insert(replicaEntity)
          .values({
            traceId,
            dataSourceId: targetConnectionId,
            entityType: targetObject,
            entityId: destVendorId,
            data: resPayload,
            version: 1,
          })
          .onConflictDoUpdate({
            target: [
              replicaEntity.dataSourceId,
              replicaEntity.entityType,
              replicaEntity.entityId,
            ],
            set: {
              data: resPayload,
              traceId,
              version: sql`${replicaEntity.version} + 1`,
              updatedAt: sql`NOW()`,
            },
          });
      }
    });

    // ── Source Schema Transaction ──────────────────────────────────────────
    let sourceCommitted = false;
    try {
      // ── Write GEM (Control Plane) ──────────────────────────────────────────
      if (
        finalStatus === "SUCCESS" &&
        srcVendorId &&
        destVendorId &&
        targetAppName &&
        targetTenantId
      ) {
        await this.gemService.writeGemMapping(tenantDb, {
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

      await tenantDb.transaction(async (tx) => {
        assertValidSchemaName(srcSchemaName);
        await tx.execute(
          sql`SET LOCAL search_path TO ${sql.raw('"' + srcSchemaName + '"')}`,
        );

        const { syncLog, activeSyncLocks } = buildTenantSchema(srcSchemaName);

        await tx
          .insert(syncLog)
          .values({
            traceId,
            routeId,
            layer: "L6",
            status: finalStatus,
            durationMs: Date.now() - start,
          })
          .onConflictDoNothing({
            target: [
              syncLog.traceId,
              syncLog.routeId,
              syncLog.layer,
              syncLog.status,
            ],
            where: sql`${syncLog.routeId} IS NOT NULL`,
          });

        // Simple lock release: If a final status is reached, delete the lock for this traceId
        if (finalStatus !== "RETRY") {
          await tx
            .delete(activeSyncLocks)
            .where(sql`${activeSyncLocks.lockedByTraceId} = ${traceId}`);
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
