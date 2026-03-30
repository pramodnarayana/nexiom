/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import {
  Injectable,
  Inject,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from "@nestjs/common";
import { eq } from "drizzle-orm";
import { QueueService, QueueName } from "@nexiom/queue";
import {
  DATABASE_CONNECTION,
  buildTenantSchema,
  assertValidSchemaName,
  integrationStitches,
  fieldMappings,
  appConnections,
} from "@nexiom/database";
import type { DrizzleDb } from "@nexiom/database";
import {
  StorageResolverService,
  evaluateConditions,
  hydratePayload,
  Condition,
} from "@nexiom/engine";
import { sql } from "drizzle-orm";
import { processInChunks } from "./outbox.utils.js";
import {
  sanitizeError,
  isValidPipelineMessage,
} from "../../shared/pipeline.utils.js";

@Injectable()
export class FanOutService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(FanOutService.name);

  constructor(
    private readonly queueService: QueueService,
    @Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb,
    private readonly storageResolver: StorageResolverService,
  ) {}

  onModuleInit() {
    this.queueService.consume(QueueName.NormalizedQueue, async (msg) => {
      await this.processMessage(msg);
    });
  }

  onModuleDestroy() {}

  private async processMessage(rawMsg: unknown): Promise<void> {
    const msg = rawMsg as Record<string, unknown>;

    // ── Poison-pill guard ─────────────────────────────────────────────────────
    if (!isValidPipelineMessage(msg, ["traceId", "connectionId"])) {
      this.logger.warn(
        {
          event: "l4.invalid_message",
          layer: "L4",
          msg: JSON.stringify(msg).slice(0, 200),
        },
        "L4: dropping invalid message — missing traceId or connectionId",
      );
      return;
    }

    const traceId = msg.traceId as string;
    const connectionId = msg.connectionId as string;
    const start = Date.now();

    this.logger.debug(
      { event: "l4.started", traceId, connectionId, layer: "L4" },
      "L4 fan-out started",
    );

    try {
      // ── Find active stitches for this source connection ───────────────────
      const stitches = await this.db
        .select()
        .from(integrationStitches)
        .where(
          sql`${integrationStitches.srcConnectionId} = ${connectionId} AND ${integrationStitches.status} = 'ACTIVE'`,
        );

      if (stitches.length === 0) {
        this.logger.debug(
          { event: "l4.no_routes", traceId, connectionId, layer: "L4" },
          "No active stitches found for source connection",
        );
        return;
      }

      const schemaName =
        await this.storageResolver.resolveSchemaName(connectionId);
      const {
        normalizedEntity,
        replicaEntity,
        outboundGateway,
        deliveryOutbox,
        syncLog,
      } = buildTenantSchema(schemaName);

      // ── Read normalized data + sourceId (for GEM) in one transaction ──────
      // sourceId comes from replica_entity and is needed by DeliveryService (L5/L6)
      // to populate the Global Entity Map after successful vendor API call.
      let normalizedData: Record<string, unknown> = {};
      let canonicalType = "RAW";
      let srcVendorId: string | undefined;

      await this.db.transaction(async (tx) => {
        assertValidSchemaName(schemaName);
        await tx.execute(
          sql`SET LOCAL search_path TO ${sql.raw('"' + schemaName + '"')}`,
        );

        const normRows = await tx
          .select()
          .from(normalizedEntity)
          .where(sql`${normalizedEntity.traceId} = ${traceId}`)
          .limit(1);
        if (!normRows.length)
          throw new Error(`Normalized record for traceId ${traceId} not found`);
        normalizedData = normRows[0].data as Record<string, unknown>;
        canonicalType = normRows[0].canonicalType ?? "RAW";

        // Fetch sourceId from replicaEntity for GEM threading
        const replicaRows = await tx
          .select({ sourceId: replicaEntity.sourceId })
          .from(replicaEntity)
          .where(sql`${replicaEntity.traceId} = ${traceId}`)
          .limit(1);
        srcVendorId = replicaRows[0]?.sourceId ?? undefined;
      });

      // ── Resolve source appName for GEM (fetched once, reused per stitch) ──
      const srcConnRows = await this.db
        .select({
          appName: appConnections.appName,
          tenantId: appConnections.tenantId,
        })
        .from(appConnections)
        .where(eq(appConnections.id, connectionId))
        .limit(1);
      const srcAppName = srcConnRows[0]?.appName ?? "unknown";
      const srcTenantId = srcConnRows[0]?.tenantId ?? "unknown";

      // ── Process each stitch concurrently (capped at 5) ────────────────────
      // Using processInChunks instead of a sequential for...of loop to bound
      // concurrency and prevent a large fan-out from blocking the event loop.
      const stitchResults = await processInChunks(stitches, 5, (stitch) =>
        this.processSingleStitch(
          schemaName,
          traceId,
          connectionId,
          srcAppName,
          srcTenantId,
          srcVendorId,
          canonicalType,
          normalizedData,
          stitch,
          start,
          outboundGateway,
          deliveryOutbox,
          syncLog,
        ),
      );

      stitchResults.forEach((result, idx) => {
        if (result.status === "rejected") {
          this.logger.error(
            {
              event: "l4.stitch_chunk_error",
              stitchId: stitches[idx].id,
              traceId,
              layer: "L4",
              err: sanitizeError(result.reason),
            },
            "L4 stitch processInChunks rejection (already logged per stitch)",
          );
        }
      });

      this.logger.log(
        { event: "l4.completed", traceId, connectionId, layer: "L4" },
        "L4 fan-out completed",
      );
    } catch (err) {
      this.logger.error(
        {
          event: "l4.error",
          traceId,
          connectionId,
          layer: "L4",
          err: sanitizeError(err),
        },
        "L4 fan-out failed",
      );
      throw err;
    }
  }

  private async processSingleStitch(
    schemaName: string,
    traceId: string,
    connectionId: string,
    srcAppName: string,
    srcTenantId: string,
    srcVendorId: string | undefined,
    canonicalType: string,
    normalizedData: Record<string, unknown>,
    stitch: typeof integrationStitches.$inferSelect,
    start: number,
    outboundGateway: ReturnType<typeof buildTenantSchema>["outboundGateway"],
    deliveryOutbox: ReturnType<typeof buildTenantSchema>["deliveryOutbox"],
    syncLog: ReturnType<typeof buildTenantSchema>["syncLog"],
  ): Promise<void> {
    try {
      const conditions = stitch.syncCondition as Condition[];
      const matched = evaluateConditions(conditions, normalizedData);

      if (!matched) {
        await this.writeSyncLog(
          schemaName,
          traceId,
          stitch.id,
          "L4",
          "SKIPPED",
          Date.now() - start,
          syncLog,
        );
        return;
      }

      // ── Hydrate payload via field_mapping rules ───────────────────────────
      const mappings = await this.db
        .select()
        .from(fieldMappings)
        .where(
          sql`${fieldMappings.stitchId} = ${stitch.id} AND ${fieldMappings.sourceCanonical} = ${canonicalType}`,
        )
        .limit(1);

      let hydratedPayload: Record<string, unknown> = normalizedData;
      if (mappings.length > 0) {
        hydratedPayload = hydratePayload(
          mappings[0].mappingRules as import("@nexiom/engine").Rule[],
          normalizedData,
        );
      }

      await this.db.transaction(async (tx) => {
        assertValidSchemaName(schemaName);
        await tx.execute(
          sql`SET LOCAL search_path TO ${sql.raw('"' + schemaName + '"')}`,
        );

        // ── Idempotency: skip if this (traceId, routeId) already succeeded ──
        const successLogs = await tx
          .select()
          .from(syncLog)
          .where(
            sql`${syncLog.traceId} = ${traceId} AND ${syncLog.routeId} = ${stitch.id} AND ${syncLog.layer} = 'L4' AND ${syncLog.status} = 'SUCCESS'`,
          )
          .limit(1);

        if (successLogs.length > 0) {
          this.logger.debug(
            {
              event: "l4.skip_success",
              traceId,
              routeId: stitch.id,
              layer: "L4",
            },
            "Route already succeeded previously, skipping",
          );
          return;
        }

        // ── Write outbound_gateway BEFORE deliveryOutbox (crash-safety) ──────
        // If the process crashes between these two writes, the next outbox
        // worker sweep will re-insert the deliveryOutbox row — the
        // onConflictDoUpdate on outbound_gateway is idempotent.
        const [outbound] = await tx
          .insert(outboundGateway)
          .values({
            traceId,
            routeId: stitch.id,
            reqPayload: hydratedPayload,
            status: "PENDING",
          })
          .onConflictDoUpdate({
            target: [outboundGateway.traceId, outboundGateway.routeId],
            set: {
              reqPayload: hydratedPayload,
              // Reset to PENDING on replay so the delivery outbox worker can
              // re-claim the row. attemptCount is intentionally omitted here
              // — L5 (DeliveryService) is the sole owner of retry accounting.
              status: "PENDING",
              updatedAt: sql`NOW()`,
            },
          })
          .returning({ id: outboundGateway.id });

        // ── Delivery outbox payload includes all fields needed by L5+L6 ──────
        // srcVendorId and canonicalType are threaded here so DeliveryService
        // can write the Global Entity Map without an extra JOIN.
        await tx
          .insert(deliveryOutbox)
          .values({
            traceId,
            routeId: stitch.id,
            outboundGatewayId: outbound.id,
            payload: {
              traceId,
              connectionId,
              targetConnectionId: stitch.destConnectionId,
              routeId: stitch.id,
              outboundGatewayId: outbound.id,
              // GEM fields threaded from L2/L3
              srcVendorId: srcVendorId ?? null,
              canonicalType,
              srcAppName,
              srcTenantId,
            },
            status: "PENDING",
          })
          .onConflictDoNothing({
            target: [
              deliveryOutbox.traceId,
              deliveryOutbox.routeId,
              deliveryOutbox.outboundGatewayId,
            ],
          });

        // ── SUCCESS sync_log — idempotent (uq_sync_log_trace_layer_status) ──
        await tx
          .insert(syncLog)
          .values({
            traceId,
            routeId: stitch.id,
            layer: "L4",
            status: "SUCCESS",
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
    } catch (err) {
      this.logger.error(
        {
          event: "l4.stitch_error",
          stitchId: stitch.id,
          traceId,
          connectionId,
          layer: "L4",
          err: sanitizeError(err),
        },
        "L4 stitch fan-out failed — recording failure and continuing to next route",
      );
      await this.writeSyncLog(
        schemaName,
        traceId,
        stitch.id,
        "L4",
        "FAIL",
        Date.now() - start,
        syncLog,
      );
    }
  }

  private async writeSyncLog(
    schemaName: string,
    traceId: string,
    routeId: string,
    layer: "L1" | "L2" | "L3" | "L4" | "L5",
    status: "PROCESSING" | "SUCCESS" | "FAIL" | "SKIPPED",
    durationMs: number,
    syncLog: ReturnType<typeof buildTenantSchema>["syncLog"],
  ) {
    await this.db.transaction(async (tx) => {
      assertValidSchemaName(schemaName);
      await tx.execute(
        sql`SET LOCAL search_path TO ${sql.raw('"' + schemaName + '"')}`,
      );
      // onConflictDoNothing prevents uq_sync_log_trace_layer_status violations on
      // replay — if this (traceId, routeId, layer, status) tuple already exists, skip.
      await tx
        .insert(syncLog)
        .values({
          traceId,
          routeId,
          layer,
          status,
          durationMs,
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
