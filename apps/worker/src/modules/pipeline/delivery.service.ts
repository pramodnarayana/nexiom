import {
  Injectable,
  Inject,
  OnModuleInit,
  OnModuleDestroy,
  Optional,
  Logger,
} from "@nestjs/common";
import { eq, sql } from "drizzle-orm";
import { QueueService, QueueName } from "@nexiom/queue";
import {
  DATABASE_CONNECTION,
  buildTenantSchema,
  assertValidSchemaName,
  integrationStitches,
  appConnections,
  globalEntityMap,
} from "@nexiom/database";
import type { DrizzleDb } from "@nexiom/database";
import { StorageResolverService } from "@nexiom/engine";
import { PieceRegistryService } from "@nexiom/piece-registry";
import { TokenManagerService } from "@nexiom/credentials";
import { RetryableException } from "@nexiom/piece-framework";
import {
  sanitizeError,
  isValidPipelineMessage,
} from "../../shared/pipeline.utils.js";

/** Maximum number of executeAction attempts before permanently failing. */
const MAX_DELIVERY_ATTEMPTS = 5;

@Injectable()
export class DeliveryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DeliveryService.name);

  constructor(
    private readonly queueService: QueueService,
    @Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb,
    private readonly storageResolver: StorageResolverService,
    private readonly pieceRegistry: PieceRegistryService,
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
        "srcConnectionId",
        "destConnectionId",
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
    const connectionId = msg.srcConnectionId as string;
    const targetConnectionId = msg.destConnectionId as string;
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

    this.logger.debug(
      {
        event: "l5.started",
        traceId,
        connectionId,
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
        await this.storageResolver.resolveSchemaName(connectionId);

      const { outboundGateway } = buildTenantSchema(destSchemaName);

      // ── TX-1: Insert PENDING or fetch existing outbound_gateway ─
      let currentAttemptCount = 0;
      let currentStatus = "";
      let sourceFinalized = false;
      await this.db.transaction(async (tx) => {
        assertValidSchemaName(destSchemaName);
        await tx.execute(
          sql`SET LOCAL search_path TO ${sql.raw('"' + destSchemaName + '"')}`,
        );

        await tx
          .insert(outboundGateway)
          .values({
            traceId,
            routeId,
            reqPayload: hydratedPayload,
            status: "PENDING",
            attemptCount: 0,
          })
          .onConflictDoNothing({
            target: [outboundGateway.traceId, outboundGateway.routeId],
          })
          .returning({ id: outboundGateway.id });

        const ob = await tx
          .select({
            id: outboundGateway.id,
            attemptCount: outboundGateway.attemptCount,
            status: outboundGateway.status,
          })
          .from(outboundGateway)
          .where(
            sql`${outboundGateway.traceId} = ${traceId} AND ${outboundGateway.routeId} = ${routeId}`,
          )
          .limit(1);

        if (!ob.length) throw new Error("Outbound gateway record not found");
        outboundGatewayId = ob[0].id;
        currentAttemptCount = ob[0].attemptCount ?? 0;
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
          connectionId,
          traceId,
          routeId,
          null, // resPayload
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
        );
        return; // Exit safely, message is acknowledged
      }

      // ── Check if delivery already succeeded AND source-side finalized ─────
      if (currentStatus === "SUCCESS") {
        // Verify source-side finalization completed by checking sync_log
        sourceFinalized = await this.isSourceFinalized(
          srcSchemaName,
          traceId,
          routeId,
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

          sourceFinalized = await this.retrySourceFinalization(
            destSchemaName,
            srcSchemaName,
            outboundGatewayId,
            traceId,
            routeId,
            connectionId,
            targetConnectionId,
            "SUCCESS",
            200,
            canonicalType,
            srcAppName,
            srcTenantId,
            srcVendorId,
            start,
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
        sourceFinalized = await this.isSourceFinalized(
          srcSchemaName,
          traceId,
          routeId,
        );
        if (sourceFinalized) {
          this.logger.debug(
            { event: "l5.skip_fail", traceId, routeId, layer: "L5" },
            "Delivery already failed and source finalized, skipping duplicate processing",
          );
          return; // Safely acknowledge duplicate message
        } else {
          this.logger.warn(
            {
              event: "l5.partial_fail",
              traceId,
              routeId,
              layer: "L5",
            },
            "Delivery failed but source-side incomplete — retrying finalization only",
          );

          sourceFinalized = await this.retrySourceFinalization(
            destSchemaName,
            srcSchemaName,
            outboundGatewayId,
            traceId,
            routeId,
            connectionId,
            targetConnectionId,
            "FAIL",
            500,
            canonicalType,
            srcAppName,
            srcTenantId,
            srcVendorId,
            start,
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

      // ── Resolve target piece using typed appConnections query ─────────────
      const connRows = await this.db
        .select({
          appName: appConnections.appName,
          tenantId: appConnections.tenantId,
        })
        .from(appConnections)
        .where(eq(appConnections.id, targetConnectionId))
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
      await this.db.transaction(async (tx) => {
        assertValidSchemaName(destSchemaName);
        await tx.execute(
          sql`SET LOCAL search_path TO ${sql.raw('"' + destSchemaName + '"')}`,
        );
        const claimRes = await tx
          .update(outboundGateway)
          .set({
            status: "PROCESSING",
            attemptCount: sql`${outboundGateway.attemptCount} + 1`,
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

      const stitchDocs = await this.db
        .select()
        .from(integrationStitches)
        .where(sql`id = ${routeId}`)
        .limit(1);
      const targetObject = stitchDocs[0]?.targetObject ?? "";

      // ── Call piece.executeAction ──────────────────────────────────────────
      let resPayload: Record<string, unknown> | null = null;
      let respEntityId: string | undefined = undefined;
      let statusCode = 500;
      let finalStatus: "SUCCESS" | "FAIL" | "RETRY" = "FAIL";

      try {
        const resp = await piece.executeAction(
          targetObject,
          hydratedPayload,
          credentials as unknown as Record<string, unknown>,
        );
        resPayload = resp.body;
        respEntityId = resp.entityId;
        statusCode = resp.statusCode ?? 200;

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
        connectionId,
        traceId,
        routeId,
        resPayload ?? null,
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
      const sanitized = sanitizeError(err);
      this.logger.error(
        {
          event: "l5.error",
          traceId,
          routeId,
          connectionId,
          outboundGatewayId,
          layer: "L5",
          err: sanitized,
        },
        "DeliveryService encountered an error",
      );
      throw err; // SQS will natively retry
    }
  }

  /**
   * Check if source-side finalization completed for a given delivery.
   * Verifies that sync_log contains a SUCCESS/FAIL entry for this (traceId, routeId) at L6.
   */
  private async isSourceFinalized(
    srcSchemaName: string,
    traceId: string,
    routeId: string,
  ): Promise<boolean> {
    try {
      const { syncLog } = buildTenantSchema(srcSchemaName);
      const logs = await this.db.transaction(async (tx) => {
        assertValidSchemaName(srcSchemaName);
        await tx.execute(
          sql`SET LOCAL search_path TO ${sql.raw('"' + srcSchemaName + '"')}`,
        );
        return await tx
          .select()
          .from(syncLog)
          .where(
            sql`${syncLog.traceId} = ${traceId} AND ${syncLog.routeId} = ${routeId} AND ${syncLog.layer} = 'L6' AND ${syncLog.status} != 'RETRY'`,
          )
          .limit(1);
      });
      return logs.length > 0;
    } catch (err) {
      this.logger.error(
        {
          event: "l5.source_finalized_check_failed",
          traceId,
          routeId,
          layer: "L5",
          err: sanitizeError(err),
        },
        "Failed to check source finalization status — assuming incomplete",
      );
      return false;
    }
  }

  /**
   * Retry source-side finalization for a delivery that already completed (SUCCESS or FAIL)
   * but whose source-side write didn't finish.
   */
  private async retrySourceFinalization(
    destSchemaName: string,
    srcSchemaName: string,
    outboundGatewayId: string,
    traceId: string,
    routeId: string,
    connectionId: string,
    targetConnectionId: string,
    finalStatus: "SUCCESS" | "FAIL",
    defaultStatusCode: number,
    canonicalType: string,
    srcAppName: string,
    srcTenantId: string,
    srcVendorId: string | undefined,
    start: number,
  ): Promise<boolean> {
    const { outboundGateway } = buildTenantSchema(destSchemaName);

    // Fetch existing result from outbound_gateway and retry source finalization
    const existingResult = await this.db.transaction(async (tx) => {
      assertValidSchemaName(destSchemaName);
      await tx.execute(
        sql`SET LOCAL search_path TO ${sql.raw('"' + destSchemaName + '"')}`,
      );
      return await tx
        .select({
          resPayload: outboundGateway.resPayload,
          statusCode: outboundGateway.statusCode,
        })
        .from(outboundGateway)
        .where(sql`${outboundGateway.id} = ${outboundGatewayId}`)
        .limit(1);
    });

    if (existingResult.length === 0) {
      throw new Error("Outbound gateway result not found for retry");
    }

    // Need to fetch target metadata for GEM
    const connRows = await this.db
      .select({
        appName: appConnections.appName,
        tenantId: appConnections.tenantId,
      })
      .from(appConnections)
      .where(eq(appConnections.id, targetConnectionId))
      .limit(1);

    const targetAppName = connRows[0]?.appName;
    const targetTenantId = connRows[0]?.tenantId;

    const stitchDocs = await this.db
      .select()
      .from(integrationStitches)
      .where(sql`id = ${routeId}`)
      .limit(1);
    const targetObject = stitchDocs[0]?.targetObject ?? "";

    // Extract destVendorId from existing result
    const resPayload = existingResult[0].resPayload as Record<
      string,
      unknown
    > | null;
    // Extract entityId from resPayload
    const destVendorId =
      typeof resPayload?.["entityId"] === "string"
        ? resPayload["entityId"]
        : undefined;

    return await this.writeL6Result(
      destSchemaName,
      srcSchemaName,
      outboundGatewayId,
      connectionId,
      traceId,
      routeId,
      resPayload,
      existingResult[0].statusCode ?? defaultStatusCode,
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
    );
  }

  private async writeL6Result(
    destSchemaName: string,
    srcSchemaName: string,
    outboundGatewayId: string,
    connectionId: string,
    traceId: string,
    routeId: string,
    resPayload: Record<string, unknown> | null,
    statusCode: number,
    finalStatus: "SUCCESS" | "FAIL" | "RETRY",
    start: number,
    destVendorId: string | undefined,
    canonicalType: string,
    srcAppName: string,
    srcTenantId: string,
    srcVendorId: string | undefined,
    targetConnectionId: string,
    targetAppName?: string,
    targetTenantId?: string,
    targetObject?: string,
  ): Promise<boolean> {
    // ── Destination Schema Transaction ──────────────────────────────────────
    await this.db.transaction(async (tx) => {
      assertValidSchemaName(destSchemaName);
      await tx.execute(
        sql`SET LOCAL search_path TO ${sql.raw('"' + destSchemaName + '"')}`,
      );

      const { outboundGateway, replicaEntity } =
        buildTenantSchema(destSchemaName);

      await tx
        .update(outboundGateway)
        .set({ resPayload: resPayload ?? {}, statusCode, status: finalStatus })
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
            connectionId: targetConnectionId,
            entityType: targetObject,
            entityId: destVendorId,
            data: resPayload,
            version: 1,
          })
          .onConflictDoUpdate({
            target: [
              replicaEntity.connectionId,
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
      await this.db.transaction(async (tx) => {
        assertValidSchemaName(srcSchemaName);
        await tx.execute(
          sql`SET LOCAL search_path TO ${sql.raw('"' + srcSchemaName + '"')}`,
        );

        const { syncLog, activeSyncLocks } = buildTenantSchema(srcSchemaName);

        if (
          finalStatus === "SUCCESS" &&
          srcVendorId &&
          destVendorId &&
          targetAppName &&
          targetTenantId
        ) {
          await tx
            .insert(globalEntityMap)
            .values({
              stitchId: routeId,
              sourceAppName: srcAppName,
              sourceAppId: connectionId,
              sourceOrgId: srcTenantId,
              sourceEntityType: canonicalType,
              sourceEntityId: srcVendorId,
              sourceRefLayer: "L2",
              sourceTraceId: traceId,
              destAppName: targetAppName,
              destAppId: targetConnectionId,
              destOrgId: targetTenantId,
              destEntityType: canonicalType,
              destEntityId: destVendorId,
              destRefLayer: "L6",
              destTraceId: traceId,
            })
            .onConflictDoUpdate({
              target: [
                globalEntityMap.stitchId,
                globalEntityMap.sourceAppId,
                globalEntityMap.sourceEntityId,
                globalEntityMap.destAppId,
                globalEntityMap.destEntityType,
              ],
              set: {
                destEntityId: destVendorId,
                destTraceId: traceId,
                lastSyncedAt: sql`NOW()`,
              },
            });
        }

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
