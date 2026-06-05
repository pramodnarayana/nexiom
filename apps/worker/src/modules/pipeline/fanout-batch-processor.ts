import { Injectable, Logger, Inject } from "@nestjs/common";
import { eq, sql } from "drizzle-orm";
import { QueueService, QueueName } from "@soopa/queue";
import {
  assertValidSchemaName,
  integrationStitches,
  fieldMappings,
  dataSources,
  globalEntityMap,
  buildTenantSchema,
} from "@soopa/database";
import type { DrizzleDb } from "@soopa/database";
import {
  StorageResolverService,
  ApplicationLoaderService,
  PipelineHookBrokerService,
  evaluateConditions,
  type Condition,
  type Rule,
} from "@soopa/engine";
import { DB_MANAGER, type DatabaseManager } from "@soopa/dbmanager";
import { DependenciesMissingError } from "@soopa/piece-framework";
import { TargetBuilderService } from "./target-builder.service.js";
import {
  sanitizeError,
  sanitizeErrorObject,
} from "../../shared/pipeline.utils.js";

@Injectable()
export class FanoutBatchProcessor {
  private readonly logger = new Logger(FanoutBatchProcessor.name);
  private readonly broker: PipelineHookBrokerService;

  constructor(
    private readonly queueService: QueueService,
    private readonly storageResolver: StorageResolverService,
    private readonly targetBuilder: TargetBuilderService,
    @Inject(DB_MANAGER) private readonly dbManager: DatabaseManager,
    applicationLoader: ApplicationLoaderService,
  ) {
    this.broker = new PipelineHookBrokerService(applicationLoader);
  }

  async processSingleStitch(
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
        return;
      }

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
        return;
      }

      const mappingRules = mappings[0].mappingRules as Rule[];

      let hydratedPayload = await this.targetBuilder.buildPayload(
        schemaName,
        srcAppName,
        appProfile,
        canonicalType,
        srcVendorId,
        normalizedData,
        mappingRules,
      );

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
        throw new DependenciesMissingError([
          { entityType: "connection", sourceId: stitch.destDataSourceId },
        ]);
      }

      const destAppName = destConnMeta.appName;
      const destAppProfile = (destConnMeta.metadata as Record<string, any>)
        ?.appProfile as string | undefined;

      if (!destAppProfile) {
        throw new DependenciesMissingError([
          { entityType: "appProfile", sourceId: stitch.destDataSourceId },
        ]);
      }

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

        const destSchemaName = await this.storageResolver.resolveSchemaName(
          stitch.destDataSourceId,
        );
        assertValidSchemaName(destSchemaName);

        let shouldPublish = false;
        await tenantDb.transaction(async (destTx) => {
          await destTx.execute(
            sql`SET LOCAL search_path TO ${sql.raw('"' + destSchemaName + '"')}`,
          );

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

          if (result.rows.length > 0) {
            shouldPublish = true;
          }
        });

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
            throw sendErr;
          }

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
          this.logger.debug(
            {
              event: "l4.skip_already_processed",
              traceId,
              routeId: stitch.id,
              layer: "L4",
            },
            "Route already processed (outbound_gateway in non-retriable state), skipping",
          );
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

        const destSchemaName = await this.storageResolver.resolveSchemaName(
          stitch.destDataSourceId,
        );
        assertValidSchemaName(destSchemaName);

        let shouldPublishActiveFetch = false;
        await tenantDb.transaction(async (destTx) => {
          await destTx.execute(
            sql`SET LOCAL search_path TO ${sql.raw('"' + destSchemaName + '"')}`,
          );

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

          if (result.rows.length > 0) {
            shouldPublishActiveFetch = true;
          }
        });

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
    } finally {
      // Decrement lock count exactly once per stitch regardless of outcome
      if (srcVendorId) {
        lockRefCount.count--;
      }
    }
  }

  async writeSyncLog(
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
}
