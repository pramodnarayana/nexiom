import {
  Injectable,
  Inject,
  OnModuleInit,
  OnModuleDestroy,
  Optional,
  Logger,
} from "@nestjs/common";
import { eq } from "drizzle-orm";
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
import { StorageResolverService, PieceRegistryService } from "@nexiom/engine";
import { sql } from "drizzle-orm";
import { TokenManagerService } from "@nexiom/connectors";
import { RetryableException } from "@nexiom/connectors";
import {
  sanitizeError,
  isValidPipelineMessage,
  isRetryableStatusCode,
  extractDestVendorId,
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
        "connectionId",
        "targetConnectionId",
        "routeId",
        "outboundGatewayId",
      ])
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
    const connectionId = msg.connectionId as string;
    const targetConnectionId = msg.targetConnectionId as string;
    const routeId = msg.routeId as string;
    const outboundGatewayId = msg.outboundGatewayId as string;
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

    try {
      const srcSchemaName =
        await this.storageResolver.resolveSchemaName(connectionId);
      const { outboundGateway } = buildTenantSchema(srcSchemaName);

      // ── TX-1: Read reqPayload and current attemptCount from outbound_gateway ─
      let reqPayload: Record<string, unknown> = {};
      let currentAttemptCount = 0;
      await this.db.transaction(async (tx) => {
        assertValidSchemaName(srcSchemaName);
        await tx.execute(
          sql`SET LOCAL search_path TO ${sql.raw('"' + srcSchemaName + '"')}`,
        );
        const ob = await tx
          .select({
            reqPayload: outboundGateway.reqPayload,
            attemptCount: outboundGateway.attemptCount,
          })
          .from(outboundGateway)
          .where(sql`${outboundGateway.id} = ${outboundGatewayId}`)
          .limit(1);
        if (!ob.length) throw new Error("Outbound gateway record not found");
        reqPayload = ob[0].reqPayload as Record<string, unknown>;
        currentAttemptCount = ob[0].attemptCount ?? 0;
      });

      // ── MAX_ATTEMPTS guard ────────────────────────────────────────────────
      // The delivery outbox worker increments attempts before handing to this
      // service. If the count already meets or exceeds the cap, permanently fail
      // without calling the piece to avoid hammering a vendor API unnecessarily.
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
          srcSchemaName,
          outboundGatewayId,
          connectionId,
          traceId,
          routeId,
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
        );
        return;
      }

      if (!this.tokenManagerService) {
        this.logger.warn(
          { event: "l5.no_token_manager", traceId, layer: "L5" },
          "TokenManagerService not available; skipping delivery",
        );
        return;
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
      // Uses conditional WHERE to prevent double-processing if another worker
      // already claimed the row (FOR UPDATE SKIP LOCKED at the outbox worker level
      // provides the first guard; this is the second guard at service level).
      let claimed = false;
      await this.db.transaction(async (tx) => {
        assertValidSchemaName(srcSchemaName);
        await tx.execute(
          sql`SET LOCAL search_path TO ${sql.raw('"' + srcSchemaName + '"')}`,
        );
        const claimRes = await tx
          .update(outboundGateway)
          .set({
            status: "PROCESSING",
            attemptCount: sql`${outboundGateway.attemptCount} + 1`,
          })
          .where(
            sql`${outboundGateway.id} = ${outboundGatewayId} AND (${outboundGateway.status} = 'PENDING' OR ${outboundGateway.status} = 'RETRY')`,
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
        return;
      }

      const stitchDocs = await this.db
        .select()
        .from(integrationStitches)
        .where(sql`id = ${routeId}`)
        .limit(1);
      const targetObject = stitchDocs[0]?.targetObject ?? "";

      // ── Call piece.executeAction ──────────────────────────────────────────
      let resPayload: Record<string, unknown> | null = null;
      let statusCode = 500;
      let finalStatus: "SUCCESS" | "FAIL" | "RETRY" = "FAIL";

      try {
        const resp = await piece.executeAction(
          targetObject,
          reqPayload,
          credentials as unknown as Record<string, unknown>,
        );
        resPayload = resp.body;
        statusCode = resp.statusCode ?? 200;

        if (statusCode >= 200 && statusCode < 300) {
          finalStatus = "SUCCESS";
        } else if (isRetryableStatusCode(statusCode)) {
          // Transient vendor error — retry via delivery outbox worker backoff
          finalStatus = "RETRY";
        } else {
          finalStatus = "FAIL";
        }
      } catch (error_: unknown) {
        // RetryableException signals a transient failure that should be retried.
        // Any other error is treated as a permanent failure.
        if (error_ instanceof RetryableException) {
          statusCode = error_.statusCode;
          finalStatus = "RETRY";
          resPayload = { error: sanitizeError(error_) };
          this.logger.warn(
            {
              event: "l5.retryable_error",
              err: sanitizeError(error_),
              statusCode,
              traceId,
              layer: "L5",
            },
            "Piece executeAction raised RetryableException — will retry",
          );
        } else {
          const errObj = error_ as Record<string, unknown>;
          statusCode =
            typeof errObj?.["statusCode"] === "number"
              ? errObj["statusCode"]
              : 500;

          // Even non-retryable thrown status codes may be transient (502/503/504)
          if (isRetryableStatusCode(statusCode)) {
            finalStatus = "RETRY";
          } else {
            finalStatus = "FAIL";
          }

          resPayload = { error: sanitizeError(error_) };
          this.logger.error(
            {
              event: "l5.execute_failed",
              err: sanitizeError(error_),
              statusCode,
              traceId,
              routeId,
              layer: "L5",
            },
            "Piece executeAction threw an error",
          );
        }
      }

      // ── TX-3 (L6): Write result, GEM upsert, sync_log ────────────────────
      const destVendorId =
        finalStatus === "SUCCESS" ? extractDestVendorId(resPayload) : undefined;

      await this.writeL6Result(
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
      );

      this.logger.log(
        { event: `l6.completed`, traceId, routeId, finalStatus, layer: "L6" },
        "L6 delivery completed",
      );
    } catch (err: unknown) {
      // On unexpected error, attempt to mark outbound_gateway as FAIL and write error sync_log.
      try {
        const srcSchemaName =
          await this.storageResolver.resolveSchemaName(connectionId);
        await this.db.transaction(async (tx) => {
          assertValidSchemaName(srcSchemaName);
          await tx.execute(
            sql`SET LOCAL search_path TO ${sql.raw('"' + srcSchemaName + '"')}`,
          );
          const { outboundGateway, syncLog } = buildTenantSchema(srcSchemaName);
          await tx
            .update(outboundGateway)
            .set({ status: "FAIL" })
            .where(sql`${outboundGateway.id} = ${outboundGatewayId}`);
          await tx
            .insert(syncLog)
            .values({
              traceId,
              routeId,
              layer: "L6",
              status: "FAIL",
              durationMs: Date.now() - start,
            })
            .onConflictDoNothing({
              target: [
                syncLog.traceId,
                syncLog.routeId,
                syncLog.layer,
                syncLog.status,
              ],
            });
        });
      } catch {
        // Swallow rollback errors — original error is rethrown below.
      }
      throw err;
    }
  }

  /**
   * TX-3 (L6): Persists delivery result to outbound_gateway, writes GEM upsert
   * on success, and records audit row in sync_log. All within a single atomic
   * transaction to guarantee consistency even if the process crashes mid-write.
   */
  private async writeL6Result(
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
  ): Promise<void> {
    const { outboundGateway, syncLog } = buildTenantSchema(srcSchemaName);

    await this.db.transaction(async (tx) => {
      assertValidSchemaName(srcSchemaName);
      await tx.execute(
        sql`SET LOCAL search_path TO ${sql.raw('"' + srcSchemaName + '"')}`,
      );

      // Update outbound_gateway with result
      await tx
        .update(outboundGateway)
        .set({ resPayload: resPayload ?? {}, statusCode, status: finalStatus })
        .where(sql`${outboundGateway.id} = ${outboundGatewayId}`);

      // ── Global Entity Map upsert (L6 write) ──────────────────────────────
      // Only write GEM on successful delivery with both source and destination IDs.
      // ON CONFLICT DO UPDATE keeps the destEntityId current for subsequent syncs
      // of the same source record (e.g. an updated Invoice).
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
            // connectionId IS the app_connection.id (UUID FK to appConnections)
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

      // Sync log audit row — idempotent on (traceId, routeId, layer, status)
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
        });
    });
  }
}
