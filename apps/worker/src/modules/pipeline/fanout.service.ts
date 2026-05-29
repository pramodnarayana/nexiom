import {
  Injectable,
  Inject,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from "@nestjs/common";
import { eq, and } from "drizzle-orm";
import { QueueService, QueueName } from "@nexiom/queue";
import {
  DATABASE_CONNECTION,
  buildTenantSchema,
  assertValidSchemaName,
  integrationStitches,
  fieldMappings,
  dataSources,
  globalEntityMap,
} from "@nexiom/database";
import type { DrizzleDb } from "@nexiom/database";
import {
  StorageResolverService,
  ApplicationLoaderService,
  PipelineHookBrokerService,
  evaluateConditions,
  Condition,
} from "@nexiom/engine";
import type { Rule } from "@nexiom/engine";
import { DB_MANAGER } from "@nexiom/dbmanager";
import type { DatabaseManager } from "@nexiom/dbmanager";
import { DependenciesMissingError } from "@nexiom/piece-framework";
import { sql } from "drizzle-orm";
import { processInChunks } from "./outbox.utils.js";
import {
  sanitizeError,
  isValidPipelineMessage,
  sanitizeErrorObject,
} from "../../shared/pipeline.utils.js";
import { TargetBuilderService } from "./target-builder.service.js";

@Injectable()
export class FanOutService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(FanOutService.name);
  constructor(
    private readonly queueService: QueueService,
    @Inject(DATABASE_CONNECTION) private readonly globalDb: DrizzleDb,
    private readonly storageResolver: StorageResolverService,
    private readonly targetBuilder: TargetBuilderService,
    @Inject(DB_MANAGER) private readonly dbManager: DatabaseManager,
    private readonly applicationLoader: ApplicationLoaderService,
  ) {
    this.broker = new PipelineHookBrokerService(this.applicationLoader);
  }

  private readonly broker: PipelineHookBrokerService;

  onModuleInit() {
    this.queueService.consume(QueueName.NormalizedQueue, async (msg) => {
      await this.processMessage(msg);
    });
  }

  onModuleDestroy() {}

  private async processMessage(rawMsg: unknown): Promise<void> {
    const msg = rawMsg as Record<string, unknown>;

    // ── Poison-pill guard ─────────────────────────────────────────────────────
    if (!isValidPipelineMessage(msg, ["traceId", "dataSourceId"])) {
      this.logger.warn(
        {
          event: "l4.invalid_message",
          layer: "L4",
          msg: JSON.stringify(msg).slice(0, 200),
        },
        "L4: dropping invalid message — missing traceId or dataSourceId",
      );
      return;
    }

    const traceId = msg.traceId as string;
    const dataSourceId = msg.dataSourceId as string;
    const start = Date.now();

    this.logger.log(
      `[DEBUG] L4 FanOut received message from NormalizedQueue (traceId: ${traceId})`,
    );

    this.logger.log(
      { event: "l4.started", traceId, dataSourceId, layer: "L4" },
      "L4 fan-out started",
    );

    // Reference-counted lock tracker for this message processing
    const lockRefCount = { count: 0 };

    try {
      // ── Resolve schema first to get entityId for potential lock cleanup ────
      const connectionMeta = await this.globalDb
        .select({ tenantId: dataSources.tenantId })
        .from(dataSources)
        .where(eq(dataSources.id, dataSourceId))
        .limit(1)
        .then((rows) => rows[0]);
      if (!connectionMeta) {
        throw new Error(`Connection ${dataSourceId} not found in global DB`);
      }

      const tenantId = connectionMeta.tenantId;
      const tenantDb = await this.dbManager.getTenantDb(tenantId);

      const schemaName =
        await this.storageResolver.resolveSchemaName(dataSourceId);
      const { normalizedEntity, replicaEntity, syncLog } =
        buildTenantSchema(schemaName);

      // ── Read normalized data + sourceId (for GEM) in one transaction ──────
      // sourceId comes from replica_entity and is needed by DeliveryService (L5/L6)
      // to populate the Global Entity Map after successful vendor API call.
      let normalizedData: Record<string, unknown> = {};
      let canonicalType = "RAW";
      let srcVendorId: string | undefined;

      const fanoutResult = await tenantDb.transaction(async (tx) => {
        assertValidSchemaName(schemaName);
        await tx.execute(
          sql`SET LOCAL search_path TO ${sql.raw('"' + schemaName + '"')}`,
        );

        // ── Primary lookup: exact traceId match ──────────────────────────────
        const normRows = await tx
          .select()
          .from(normalizedEntity)
          .where(sql`${normalizedEntity.traceId} = ${traceId}`)
          .limit(1);

        if (!normRows.length) {
          // ── Superseded check ───────────────────────────────────────────────
          // normalized_entity.traceId is overwritten on each UPSERT. If the
          // entity was updated again before L4 ran, this traceId is stale.
          // First look up the replica row to get the replica_id, then check
          // if any normalized row exists for that replica (scoped query).
          const replicaRows = await tx
            .select({ replicaId: replicaEntity.id })
            .from(replicaEntity)
            .where(sql`${replicaEntity.traceId} = ${traceId}`)
            .limit(1);

          if (replicaRows.length > 0) {
            const replicaId = replicaRows[0].replicaId;
            const anyNorm = await tx
              .select({ traceId: normalizedEntity.traceId })
              .from(normalizedEntity)
              .where(
                sql`${normalizedEntity.replicaId} = ${replicaId} AND ${normalizedEntity.traceId} != ${traceId}`,
              )
              .limit(1);

            if (anyNorm.length > 0) {
              return { kind: "superseded" as const };
            }
          }

          throw new Error(
            `Normalized record for traceId ${traceId} not found and no superseding record exists. ` +
              `L3 may not have committed. The message will be retried.`,
          );
        }

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

        return { kind: "found" as const };
      });

      if (fanoutResult.kind === "superseded") {
        this.logger.log(
          {
            event: "l4.superseded",
            traceId,
            dataSourceId,
            layer: "L4",
          },
          "L4: normalized traceId superseded by newer trace — ACK without processing",
        );
        return;
      }

      // ── Find active stitches for this source connection ───────────────────
      // We read stitches from the tenant DB, enforcing the cell-based isolation
      const stitches = await tenantDb
        .select()
        .from(integrationStitches)
        .where(
          sql`${integrationStitches.canonicalObject} = ${canonicalType} AND ${integrationStitches.status} = 'ACTIVE'`,
        );

      if (stitches.length === 0) {
        this.logger.debug(
          { event: "l4.no_routes", traceId, dataSourceId, layer: "L4" },
          "No active stitches found for source connection",
        );
        // Release lock acquired in L2 — no outbound work will occur
        if (srcVendorId) {
          await this.releaseSyncLock(
            schemaName,
            dataSourceId,
            srcVendorId,
            tenantDb,
          );
        }
        return;
      }

      // ── Resolve source appName for GEM (fetched once, reused per stitch) ──
      const srcConnRows = await tenantDb
        .select({
          appName: dataSources.appName,
          tenantId: dataSources.tenantId,
          metadata: dataSources.metadata,
        })
        .from(dataSources)
        .where(eq(dataSources.id, dataSourceId))
        .limit(1);

      if (!srcConnRows.length) {
        throw new Error(
          `Source connection record not found for GEM metadata (dataSourceId=${dataSourceId}, traceId=${traceId})`,
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
        trimmedAppProfile !== "" ? trimmedAppProfile : "standard";

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
            dataSourceId,
            srcAppName,
            appProfile,
            srcTenantId,
            srcVendorId,
            canonicalType,
            normalizedData,
            stitch,
            start,
            syncLog,
            tenantDb,
            lockRefCount,
          ),
        );

        stitchResults.forEach((result, idx) => {
          if (result.status === "rejected") {
            this.logger.error(
              {
                event: "l4.stitch_resolution_failed",
                traceId,
                routeId: stitches[idx].id,
                err: sanitizeErrorObject(result.reason),
              },
              `Stitch resolution partially failed (best-effort skipped): ${sanitizeError(result.reason)}`,
            );
          }
        });
      } finally {
        // After all stitches have settled, release lock if refcount reached zero.
        // NOTE: lockRefCount is only decremented for skipped/error stitches.
        // For successful publishes, releaseSyncLock is performed by the delivery
        // path (L5/L6) for the last delivered route, maintaining the handoff contract.
        if (srcVendorId && lockRefCount.count === 0) {
          await this.releaseSyncLock(
            schemaName,
            dataSourceId,
            srcVendorId,
            tenantDb,
          );
        }
      }

      this.logger.log(
        { event: "l4.completed", traceId, dataSourceId, layer: "L4" },
        "L4 fan-out completed",
      );
    } catch (err) {
      const safeErrStr = sanitizeError(err);
      const safeErrObj = sanitizeErrorObject(err);
      this.logger.error(
        {
          event: "l4.error",
          traceId,
          dataSourceId,
          layer: "L4",
          err: safeErrObj,
        },
        `L4 fan-out failed: ${safeErrStr}`,
      );
      throw err;
    }
  }

  private async processSingleStitch(
    schemaName: string,
    traceId: string,
    dataSourceId: string,
    srcAppName: string,
    appProfile: string,
    srcTenantId: string,
    srcVendorId: string | undefined,
    canonicalType: string,
    normalizedData: Record<string, unknown>,
    stitch: typeof integrationStitches.$inferSelect,
    start: number,
    syncLog: ReturnType<typeof buildTenantSchema>["syncLog"],
    tenantDb: DrizzleDb,
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
          tenantDb,
        );
        // Decrement refcount — no outbound work will occur for this entity
        if (srcVendorId) {
          lockRefCount.count--;
        }
        return;
      }

      // ── Hydrate payload via field_mapping rules ───────────────────────────
      const mappings = await tenantDb
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
          tenantDb,
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
      let hydratedPayload = await this.targetBuilder.buildPayload(
        schemaName,
        srcAppName,
        appProfile,
        canonicalType,
        srcVendorId,
        normalizedData,
        mappingRules,
      );

      // ── Resolve destination connection metadata (always needed for shard dispatch) ──
      // appName + appProfile determine which application shard to invoke.
      // dataSources (including metadata.appProfile) lives in the TENANT DB.
      // The global DB only holds tenantId for routing — never full metadata.
      const destConnMeta = await tenantDb
        .select({
          tenantId: dataSources.tenantId,
          appName: dataSources.appName,
          metadata: dataSources.metadata,
        })
        .from(dataSources)
        .where(eq(dataSources.id, stitch.destDataSourceId))
        .limit(1)
        .then((rows) => rows[0]);
      if (!destConnMeta) {
        // Destination connection not found — treat as retryable in case of replication lag
        throw new DependenciesMissingError([
          { entityType: "connection", sourceId: stitch.destDataSourceId },
        ]);
      }
      const destAppName = destConnMeta.appName;
      const destAppProfile = (destConnMeta.metadata as Record<string, any>)
        ?.appProfile as string | undefined;

      if (!destAppProfile) {
        // Missing appProfile — treat as retryable in case metadata is backfilling
        throw new DependenciesMissingError([
          { entityType: "appProfile", sourceId: stitch.destDataSourceId },
        ]);
      }

      // ── DEBUG: trace shard resolution ──────────────────────────────────────
      this.logger.log(
        {
          event: "l4.debug.shard_resolution",
          traceId,
          destDataSourceId: stitch.destDataSourceId,
          destAppName,
          destAppProfile,
          rawMetadata: destConnMeta.metadata,
        },
        `[DEBUG] Shard will be resolved as: ${destAppName}/${destAppProfile}`,
      );

      // ── Lookup GEM destEntityId for Updates ────────────────────────────────
      // If a GEM mapping exists, this is an UPDATE operation; we fetch the
      // existing destination entity state so the shard can inject the correct
      // Id and SyncToken.  If no mapping exists this is a CREATE — destEntityId
      // and destState remain undefined.
      let destEntityId: string | undefined;
      let destState: Record<string, unknown> | undefined;

      if (srcVendorId) {
        const gemMappings = await tenantDb
          .select()
          .from(globalEntityMap)
          .where(
            sql`${globalEntityMap.stitchId} = ${stitch.id} AND ${globalEntityMap.sourceDataSourceId} = ${dataSourceId} AND ${globalEntityMap.sourceEntityId} = ${srcVendorId}`,
          )
          .limit(1);

        if (gemMappings.length > 0) {
          destEntityId = gemMappings[0].destEntityId;
          this.logger.log(
            { event: "l4.debug.gem_hit", traceId, destEntityId },
            `[DEBUG] GEM mapping found — update route, destEntityId=${destEntityId}`,
          );

          // Fetch cached destination state for SyncToken extraction
          try {
            const targetSchemaName =
              await this.storageResolver.resolveSchemaName(
                stitch.destDataSourceId,
              );
            const { replicaEntity: targetReplicaEntity } =
              buildTenantSchema(targetSchemaName);
            const destTenantDb = await this.dbManager.getTenantDb(
              destConnMeta.tenantId,
            );
            const targetReplica = await destTenantDb
              .select()
              .from(targetReplicaEntity)
              .where(
                sql`${targetReplicaEntity.dataSourceId} = ${stitch.destDataSourceId} AND ${targetReplicaEntity.entityType} = ${stitch.targetObject} AND ${targetReplicaEntity.entityId} = ${destEntityId}`,
              )
              .limit(1);
            if (targetReplica.length > 0) {
              const state = targetReplica[0].data as Record<string, unknown>;
              destState = state;
              // Try to find SyncToken at root or nested under an entity key (e.g. { Vendor: { SyncToken: "1" } })
              let debugSyncToken = (state as { SyncToken?: string })?.SyncToken;
              if (!debugSyncToken) {
                const entityKey = Object.keys(state).find(
                  (k) =>
                    k !== "time" &&
                    typeof state[k] === "object" &&
                    state[k] !== null,
                );
                if (entityKey)
                  debugSyncToken = (state[entityKey] as { SyncToken?: string })
                    ?.SyncToken;
              }
              this.logger.log(
                {
                  event: "l4.debug.dest_state_found",
                  traceId,
                  destEntityId,
                  syncToken: debugSyncToken ?? "not_found",
                },
                `[DEBUG] destState loaded — SyncToken=${debugSyncToken ?? "not_found"}`,
              );
            } else {
              this.logger.warn(
                { event: "l4.debug.dest_state_missing", traceId, destEntityId },
                `[DEBUG] No replicaEntity found for destEntityId=${destEntityId} — SyncToken will be missing`,
              );
            }
          } catch (err) {
            this.logger.error(
              { err: sanitizeErrorObject(err), traceId, routeId: stitch.id },
              `L4→L5: failed to publish stitch routing envelope: ${sanitizeError(err)}`,
            );
          }
        } else {
          this.logger.log(
            { event: "l4.debug.gem_miss", traceId, srcVendorId },
            `[DEBUG] No GEM mapping found for srcVendorId=${srcVendorId} — create route`,
          );
        }
      }

      // ── Execute Application Shard prepareUpdate hook (always) ────────────────
      // This hook runs on every route — creates and updates.  The shard decides
      // what to inject based on whether destEntityId is provided:
      //   • UPDATE (destEntityId set):  injects Id, SyncToken, sparse, domain
      //   • CREATE (destEntityId unset): injects only vendor-level defaults (sparse, domain)
      const payloadBeforePrepare = { ...hydratedPayload };
      hydratedPayload = await this.broker.prepareUpdate(
        destAppName,
        destAppProfile,
        hydratedPayload,
        destEntityId,
        destState,
      );
      this.logger.log(
        {
          event: "l4.debug.prepare_update_result",
          traceId,
          destEntityId,
          beforeKeys: Object.keys(payloadBeforePrepare),
          afterKeys: Object.keys(hydratedPayload),
          hasId: "Id" in hydratedPayload,
          hasSyncToken: "SyncToken" in hydratedPayload,
          hasSparse: "sparse" in hydratedPayload,
          hasDomain: "domain" in hydratedPayload,
        },
        `[DEBUG] prepareUpdate result — Id=${"Id" in hydratedPayload}, SyncToken=${"SyncToken" in hydratedPayload}, sparse=${"sparse" in hydratedPayload}, domain=${"domain" in hydratedPayload}`,
      );

      await tenantDb.transaction(async (tx) => {
        assertValidSchemaName(schemaName);
        await tx.execute(
          sql`SET LOCAL search_path TO ${sql.raw('"' + schemaName + '"')}`,
        );

        // ── Persist pending delivery record before publishing ─────────────────
        // Create outbound_gateway record in destination schema BEFORE sending to
        // DeliveryQueue to ensure delivery can be retried even if send() fails.
        const destSchemaName = await this.storageResolver.resolveSchemaName(
          stitch.destDataSourceId,
        );
        assertValidSchemaName(destSchemaName);

        // Execute in nested transaction on destination schema
        // Use conditional upsert with RETURNING to determine if we should publish
        let shouldPublish = false;
        await tenantDb.transaction(async (destTx) => {
          await destTx.execute(
            sql`SET LOCAL search_path TO ${sql.raw('"' + destSchemaName + '"')}`,
          );

          // Use raw SQL for conditional upsert with RETURNING to detect transitions
          const result = await destTx.execute<{ status: string }>(sql`
            INSERT INTO outbound_gateway (trace_id, route_id, data_source_id, src_data_source_id, payload, status, attempts, created_at, updated_at)
            VALUES (${traceId}, ${stitch.id}, ${stitch.destDataSourceId}, ${dataSourceId}, ${JSON.stringify(hydratedPayload)}, 'PENDING', 0, NOW(), NOW())
            ON CONFLICT (trace_id, route_id)
            DO UPDATE SET
              payload = ${JSON.stringify(hydratedPayload)},
              status = 'PENDING',
              attempts = 0,
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
              srcDataSourceId: dataSourceId,
              destDataSourceId: stitch.destDataSourceId,
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
                event: "l4.publish_outbox_failed",
                traceId,
                routeId: stitch.id,
                err: sanitizeErrorObject(sendErr),
              },
              `Failed best-effort MQ publish: ${sanitizeError(sendErr)}`,
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
          stitch.destDataSourceId,
        );
        assertValidSchemaName(destSchemaName);

        let shouldPublishActiveFetch = false;
        await tenantDb.transaction(async (destTx) => {
          await destTx.execute(
            sql`SET LOCAL search_path TO ${sql.raw('"' + destSchemaName + '"')}`,
          );

          // Use conditional upsert to only transition if not already DEFERRED_DEPENDENCY or processed
          const result = await destTx.execute<{ status: string }>(sql`
            INSERT INTO outbound_gateway (trace_id, route_id, data_source_id, src_data_source_id, payload, status, attempts, created_at, updated_at)
            VALUES (${traceId}, ${stitch.id}, ${stitch.destDataSourceId}, ${dataSourceId}, ${JSON.stringify({})}, 'DEFERRED_DEPENDENCY', 0, NOW(), NOW())
            ON CONFLICT (trace_id, route_id)
            DO UPDATE SET
              status = 'DEFERRED_DEPENDENCY',
              payload = ${JSON.stringify({})},
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
              dataSourceId,
              missingDependencies: missingDeps,
            });
          } catch (queueErr) {
            this.logger.error(
              {
                event: "l4.active_fetch_queue_failed",
                traceId,
                routeId: stitch.id,
                layer: "L4",
                err: sanitizeErrorObject(queueErr),
              },
              `Failed to publish to ActiveFetchQueue — DependencySweeperService will retry: ${sanitizeError(queueErr)}`,
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
            tenantDb,
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

      const safeErrStr = sanitizeError(err);
      const safeErrObj = sanitizeErrorObject(err);
      this.logger.error(
        {
          event: "l4.stitch_error",
          stitchId: stitch.id,
          traceId,
          dataSourceId,
          layer: "L4",
          err: safeErrObj,
        },
        `L4 stitch fan-out failed — recording failure and continuing to next route: ${safeErrStr}`,
      );
      await this.writeSyncLog(
        schemaName,
        traceId,
        stitch.id,
        "L4",
        "FAIL",
        Date.now() - start,
        syncLog,
        tenantDb,
        err instanceof Error ? err.message : String(err),
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
    tenantDb: DrizzleDb,
    errorMessage?: string,
  ) {
    await tenantDb.transaction(async (tx) => {
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
          errorMessage,
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
    dataSourceId: string,
    entityId: string,
    tenantDb: DrizzleDb,
  ): Promise<void> {
    await tenantDb.transaction(async (tx) => {
      assertValidSchemaName(schemaName);
      await tx.execute(
        sql`SET LOCAL search_path TO ${sql.raw('"' + schemaName + '"')}`,
      );
      const { activeSyncLocks } = buildTenantSchema(schemaName);
      await tx
        .delete(activeSyncLocks)
        .where(
          and(
            eq(activeSyncLocks.dataSourceId, dataSourceId),
            eq(activeSyncLocks.entityId, entityId),
          ),
        );
    });
  }
}
