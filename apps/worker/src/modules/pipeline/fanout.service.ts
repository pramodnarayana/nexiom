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
  globalEntityMap,
} from "@nexiom/database";
import type { DrizzleDb } from "@nexiom/database";
import {
  StorageResolverService,
  evaluateConditions,
  Condition,
} from "@nexiom/engine";
import type { Rule } from "@nexiom/engine";
import { DependenciesMissingError } from "@nexiom/piece-framework";
import { sql } from "drizzle-orm";
import { processInChunks } from "./outbox.utils.js";
import {
  sanitizeError,
  isValidPipelineMessage,
} from "../../shared/pipeline.utils.js";
import { TargetBuilderService } from "./target-builder.service.js";

@Injectable()
export class FanOutService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(FanOutService.name);

  constructor(
    private readonly queueService: QueueService,
    @Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb,
    private readonly storageResolver: StorageResolverService,
    private readonly targetBuilder: TargetBuilderService,
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

    this.logger.log(
      `[DEBUG] L4 FanOut received message from NormalizedQueue (traceId: ${traceId})`,
    );

    this.logger.log(
      { event: "l4.started", traceId, connectionId, layer: "L4" },
      "L4 fan-out started",
    );

    // Reference-counted lock tracker for this message processing
    const lockRefCount = { count: 0 };

    try {
      // ── Resolve schema first to get entityId for potential lock cleanup ────
      const schemaName =
        await this.storageResolver.resolveSchemaName(connectionId);
      const { normalizedEntity, replicaEntity, syncLog, activeSyncLocks } =
        buildTenantSchema(schemaName);

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

        // Fetch entityId from replicaEntity for GEM threading
        const replicaRows = await tx
          .select({ entityId: replicaEntity.entityId })
          .from(replicaEntity)
          .where(sql`${replicaEntity.traceId} = ${traceId}`)
          .limit(1);
        if (!replicaRows.length) {
          throw new Error(
            `Replica record not found for GEM threading (traceId=${traceId})`,
          );
        }
        srcVendorId = replicaRows[0].entityId ?? undefined;
      });

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
        // Release lock acquired in L2 — no outbound work will occur
        if (srcVendorId) {
          await this.releaseSyncLock(
            schemaName,
            connectionId,
            srcVendorId,
            activeSyncLocks,
            traceId,
          );
        }
        return;
      }

      // ── Resolve source appName for GEM (fetched once, reused per stitch) ──
      const srcConnRows = await this.db
        .select({
          appName: appConnections.appName,
          tenantId: appConnections.tenantId,
          metadata: appConnections.metadata,
        })
        .from(appConnections)
        .where(eq(appConnections.id, connectionId))
        .limit(1);

      if (!srcConnRows.length) {
        throw new Error(
          `Source connection record not found for GEM metadata (connectionId=${connectionId}, traceId=${traceId})`,
        );
      }
      const srcAppName = srcConnRows[0].appName;
      const srcTenantId = srcConnRows[0].tenantId;
      const metadata = srcConnRows[0].metadata as Record<
        string,
        unknown
      > | null;

      // Runtime validation of appProfile (matches NormalizationService)
      const trimmedAppProfile =
        typeof metadata?.appProfile === "string"
          ? metadata.appProfile.trim()
          : "";
      const appProfile =
        trimmedAppProfile !== "" ? trimmedAppProfile : "default";

      // ── Process each stitch concurrently (capped at 5) ────────────────────
      // Using processInChunks instead of a sequential for...of loop to bound
      // concurrency and prevent a large fan-out from blocking the event loop.
      // Initialize refcount immediately before work that will decrement it
      lockRefCount.count = stitches.length;

      try {
        const stitchResults = await processInChunks(stitches, 5, (stitch) =>
          this.processSingleStitch(
            schemaName,
            traceId,
            connectionId,
            srcAppName,
            appProfile,
            srcTenantId,
            srcVendorId,
            canonicalType,
            normalizedData,
            stitch,
            start,
            syncLog,
            activeSyncLocks,
            lockRefCount,
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
      } finally {
        // After all stitches have settled, release lock if refcount reached zero
        if (srcVendorId && lockRefCount.count === 0) {
          await this.releaseSyncLock(
            schemaName,
            connectionId,
            srcVendorId,
            activeSyncLocks,
            traceId,
          );
        }
      }

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
    appProfile: string,
    srcTenantId: string,
    srcVendorId: string | undefined,
    canonicalType: string,
    normalizedData: Record<string, unknown>,
    stitch: typeof integrationStitches.$inferSelect,
    start: number,
    syncLog: ReturnType<typeof buildTenantSchema>["syncLog"],
    _activeSyncLocks: ReturnType<typeof buildTenantSchema>["activeSyncLocks"],
    lockRefCount: { count: number },
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
        // Decrement refcount — no outbound work will occur for this entity
        if (srcVendorId) {
          lockRefCount.count--;
        }
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

      if (mappings.length === 0) {
        this.logger.log(
          {
            event: "l4.skip_no_mapping",
            traceId,
            routeId: stitch.id,
            layer: "L4",
            canonicalType,
          },
          `[DEBUG] No field mapping rules configured for canonicalType=${canonicalType}, skipping stitch route`,
        );
        await this.writeSyncLog(
          schemaName,
          traceId,
          stitch.id,
          "L4",
          "SKIPPED",
          Date.now() - start,
          syncLog,
        );
        // Decrement refcount — no outbound work will occur for this entity
        if (srcVendorId) {
          lockRefCount.count--;
        }
        return;
      }

      // ── Build outbound payload ────────────────────────────────────────────
      // TargetBuilderService calls the app-registered AppTargetBuilderFn hook
      // (e.g. tmsTargetBuilder) which does the SQL JOIN enrichment across
      // typed per-entity tables, then applies the field mapping rules.
      const mappingRules = mappings[0].mappingRules as Rule[];

      // Delegate to TargetBuilderService — it calls the app-registered hook
      // (e.g. tmsTargetBuilder) to assemble the enriched context from typed
      // per-entity tables, then applies the field mapping rules.
      // appProfile is threaded from processMessage context (read from connection.metadata)
      const hydratedPayload = await this.targetBuilder.buildPayload(
        schemaName,
        srcAppName,
        appProfile,
        canonicalType,
        srcVendorId,
        normalizedData,
        mappingRules,
      );

      // ── Lookup GEM destEntityId for Updates ────────────────────────────────
      if (srcVendorId) {
        const gemMappings = await this.db
          .select()
          .from(globalEntityMap)
          .where(
            sql`${globalEntityMap.stitchId} = ${stitch.id} AND ${globalEntityMap.sourceAppId} = ${connectionId} AND ${globalEntityMap.sourceEntityId} = ${srcVendorId}`,
          )
          .limit(1);

        if (gemMappings.length > 0) {
          const destEntityId = gemMappings[0].destEntityId;

          // ── Build _sync context envelope ──────────────────────────────────
          // Injected as a single structured block rather than individual keys
          // to keep the pipeline-to-piece contract clean and vendor-agnostic.
          // The Piece reads _sync.dest.id and _sync.dest.state internally.
          const syncCtx: { dest: { id: string; state?: unknown } } = {
            dest: { id: destEntityId },
          };

          try {
            const targetSchemaName =
              await this.storageResolver.resolveSchemaName(
                stitch.destConnectionId,
              );
            const { replicaEntity: targetReplicaEntity } =
              buildTenantSchema(targetSchemaName);
            const targetReplica = await this.db
              .select()
              .from(targetReplicaEntity)
              .where(
                sql`${targetReplicaEntity.connectionId} = ${stitch.destConnectionId} AND ${targetReplicaEntity.entityType} = ${stitch.targetObject} AND ${targetReplicaEntity.entityId} = ${destEntityId}`,
              )
              .limit(1);

            if (targetReplica.length > 0) {
              syncCtx.dest.state = targetReplica[0].data;
            }
          } catch (err) {
            this.logger.warn(
              { err: sanitizeError(err), traceId, routeId: stitch.id },
              "Failed to load target replica state for _sync context — omitting dest.state",
            );
          }

          hydratedPayload["_sync"] = syncCtx;
          this.logger.debug(
            {
              event: "l4.gem_lookup",
              traceId,
              routeId: stitch.id,
              layer: "L4",
              destEntityId,
            },
            "Found existing destination entity mapping (update route)",
          );
        }
      }

      await this.db.transaction(async (tx) => {
        assertValidSchemaName(schemaName);
        await tx.execute(
          sql`SET LOCAL search_path TO ${sql.raw('"' + schemaName + '"')}`,
        );

        // ── Persist pending delivery record before publishing ─────────────────
        // Create outbound_gateway record in destination schema BEFORE sending to
        // DeliveryQueue to ensure delivery can be retried even if send() fails.
        const destSchemaName = await this.storageResolver.resolveSchemaName(
          stitch.destConnectionId,
        );
        assertValidSchemaName(destSchemaName);

        const { outboundGateway: destOutboundGateway } =
          buildTenantSchema(destSchemaName);

        // Execute in nested transaction on destination schema
        // Use conditional upsert with RETURNING to determine if we should publish
        let shouldPublish = false;
        await this.db.transaction(async (destTx) => {
          await destTx.execute(
            sql`SET LOCAL search_path TO ${sql.raw('"' + destSchemaName + '"')}`,
          );

          // Use raw SQL for conditional upsert with RETURNING to detect transitions
          const result = await destTx.execute<{ status: string }>(sql`
            INSERT INTO outbound_gateway (trace_id, route_id, req_payload, status, attempt_count, created_at, updated_at)
            VALUES (${traceId}, ${stitch.id}, ${JSON.stringify(hydratedPayload)}, 'PENDING', 0, NOW(), NOW())
            ON CONFLICT (trace_id, route_id)
            DO UPDATE SET
              req_payload = ${JSON.stringify(hydratedPayload)},
              status = 'PENDING',
              attempt_count = 0,
              updated_at = NOW()
            WHERE outbound_gateway.status IN ('DEFERRED_DEPENDENCY', 'FAILED')
              OR outbound_gateway.status IS NULL
            RETURNING status, (xmax = 0) as was_insert
          `);

          // Publish only if we inserted a new row or updated from a retriable state
          if (result.rows.length > 0) {
            shouldPublish = true;
          }
        });

        // ── Publish directly to Delivery Queue (Decoupled Message Routing) ──
        // Only publish if the outboundGateway write indicated a state transition
        if (shouldPublish) {
          try {
            await this.queueService.send(QueueName.DeliveryQueue, {
              traceId,
              srcConnectionId: connectionId,
              destConnectionId: stitch.destConnectionId,
              routeId: stitch.id,
              srcVendorId: srcVendorId ?? null,
              canonicalType,
              srcAppName,
              srcTenantId,
              hydratedPayload,
            });
          } catch (sendErr) {
            this.logger.error(
              {
                event: "l4.queue_send_failed",
                traceId,
                routeId: stitch.id,
                layer: "L4",
                err: sanitizeError(sendErr),
              },
              "Failed to publish to DeliveryQueue — outbound_gateway persisted, will retry",
            );
            // Rethrow to mark L4/FAIL and trigger retry of normalized message
            throw sendErr;
          }

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
            .onConflictDoNothing();
        } else {
          // Already processed, skip and decrement refcount
          this.logger.debug(
            {
              event: "l4.skip_already_processed",
              traceId,
              routeId: stitch.id,
              layer: "L4",
            },
            "Route already processed (outbound_gateway in non-retriable state), skipping",
          );
          if (srcVendorId) {
            lockRefCount.count--;
          }
        }
      });
    } catch (err) {
      if (err instanceof DependenciesMissingError) {
        const missingDeps = err.missingDependencies;
        this.logger.warn(
          {
            event: "l4.dependencies_missing",
            stitchId: stitch.id,
            traceId,
            missingDeps,
            layer: "L4",
          },
          "Dependencies missing for target payload. Deferring route and triggering active fetch.",
        );

        // Mark route as DEFERRED_DEPENDENCY
        const destSchemaName = await this.storageResolver.resolveSchemaName(
          stitch.destConnectionId,
        );
        assertValidSchemaName(destSchemaName);
        const { outboundGateway: destOutboundGateway } =
          buildTenantSchema(destSchemaName);

        let shouldPublishActiveFetch = false;
        await this.db.transaction(async (destTx) => {
          await destTx.execute(
            sql`SET LOCAL search_path TO ${sql.raw('"' + destSchemaName + '"')}`,
          );

          // Use conditional upsert to only transition if not already DEFERRED_DEPENDENCY or processed
          const result = await destTx.execute<{ status: string }>(sql`
            INSERT INTO outbound_gateway (trace_id, route_id, req_payload, status, attempt_count, created_at, updated_at)
            VALUES (${traceId}, ${stitch.id}, ${JSON.stringify({})}, 'DEFERRED_DEPENDENCY', 0, NOW(), NOW())
            ON CONFLICT (trace_id, route_id)
            DO UPDATE SET
              status = 'DEFERRED_DEPENDENCY',
              req_payload = ${JSON.stringify({})},
              updated_at = NOW()
            WHERE outbound_gateway.status NOT IN ('DEFERRED_DEPENDENCY', 'PENDING', 'SUCCESS')
              OR outbound_gateway.status IS NULL
            RETURNING status
          `);

          // Only trigger active fetch if we actually transitioned to DEFERRED_DEPENDENCY
          if (result.rows.length > 0) {
            shouldPublishActiveFetch = true;
          }
        });

        // Publish to ActiveFetchQueue only if we transitioned to DEFERRED_DEPENDENCY
        if (shouldPublishActiveFetch) {
          try {
            await this.queueService.send(QueueName.ActiveFetchQueue, {
              traceId,
              connectionId,
              missingDependencies: missingDeps,
            });
          } catch (queueErr) {
            this.logger.error(
              {
                event: "l4.active_fetch_queue_failed",
                traceId,
                routeId: stitch.id,
                layer: "L4",
                err: sanitizeError(queueErr),
              },
              "Failed to publish to ActiveFetchQueue — DependencySweeperService will retry",
            );
            // Continue to cleanup (writeSyncLog + releaseSyncLock) despite queue failure
          }

          await this.writeSyncLog(
            schemaName,
            traceId,
            stitch.id,
            "L4",
            "SKIPPED",
            Date.now() - start,
            syncLog,
          );
        } else {
          this.logger.debug(
            {
              event: "l4.skip_already_deferred",
              traceId,
              routeId: stitch.id,
              layer: "L4",
            },
            "Route already in deferred or non-retriable state, skipping active fetch",
          );
        }

        // Decrement refcount — no outbound work will occur for this entity
        if (srcVendorId) {
          lockRefCount.count--;
        }
        return;
      }

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
      // Decrement refcount on error
      if (srcVendorId) {
        lockRefCount.count--;
      }
    }
  }

  private async writeSyncLog(
    schemaName: string,
    traceId: string,
    routeId: string | null,
    layer: "L4",
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
        .onConflictDoNothing();
    });
  }

  /**
   * Release sync lock acquired in L2.
   * Called when L4 determines no outbound work will occur (no routes, failed conditions, etc.)
   * to prevent lock from remaining until TTL expiry.
   */
  private async releaseSyncLock(
    schemaName: string,
    connectionId: string,
    entityId: string,
    activeSyncLocks: ReturnType<typeof buildTenantSchema>["activeSyncLocks"],
    traceId: string,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      assertValidSchemaName(schemaName);
      await tx.execute(
        sql`SET LOCAL search_path TO ${sql.raw('"' + schemaName + '"')}`,
      );
      await tx
        .delete(activeSyncLocks)
        .where(
          sql`${activeSyncLocks.connectionId} = ${connectionId} AND ${activeSyncLocks.entityId} = ${entityId} AND ${activeSyncLocks.lockedByTraceId} = ${traceId}`,
        );
    });
  }
}
