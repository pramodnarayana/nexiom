import { Injectable, Logger, Inject } from "@nestjs/common";
import { QueueService, QueueName } from "@soopa/queue";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { assertValidSchemaName } from "@soopa/database";
import {
  StorageResolverService,
  PipelineHookBrokerService,
  evaluateConditions,
  type Condition,
} from "../index.js";
import { DependenciesMissingError } from "@soopa/piece-framework";
import { TargetBuilderService } from "./target-builder.service.js";
import {
  sanitizeError,
  sanitizeErrorObject,
} from "../utils.js";
import { ActiveStitch } from "../shared/ports/stitch.repository.port.js";

import { CONNECTION_REPOSITORY_PORT, ConnectionRepositoryPort } from "../shared/ports/connection.repository.port.js";
import { PIPELINE_STATE_REPOSITORY_PORT, PipelineStateRepositoryPort } from "../shared/ports/pipeline-state.repository.port.js";
import { GLOBAL_ENTITY_MAP_REPOSITORY_PORT, GlobalEntityMapRepositoryPort } from "../shared/ports/global-entity-map.repository.port.js";
import { FIELD_MAPPING_REPOSITORY_PORT, FieldMappingRepositoryPort } from "../shared/ports/field-mapping.repository.port.js";
import { SYNC_LOG_REPOSITORY_PORT, SyncLogRepositoryPort } from "../shared/ports/sync-log.repository.port.js";
import { OUTBOUND_GATEWAY_REPOSITORY_PORT, OutboundGatewayRepositoryPort } from "../shared/ports/outbound-gateway.repository.port.js";

function extractSyncTokenFromState(state: Record<string, unknown>): string | undefined {
  if (state.SyncToken) return String(state.SyncToken);
  const entityKey = Object.keys(state).find(
    (k) => k !== "time" && typeof state[k] === "object" && state[k] !== null,
  );
  if (entityKey) {
    return (state[entityKey] as { SyncToken?: string })?.SyncToken;
  }
  return undefined;
}

@Injectable()
export class FanoutBatchProcessor {
  private readonly logger = new Logger(FanoutBatchProcessor.name);
  private readonly broker: PipelineHookBrokerService;

  constructor(
    private readonly queueService: QueueService,
    private readonly storageResolver: StorageResolverService,
    private readonly targetBuilder: TargetBuilderService,
    private readonly eventEmitter: EventEmitter2,
    @Inject(CONNECTION_REPOSITORY_PORT) private readonly connRepo: ConnectionRepositoryPort,
    @Inject(PIPELINE_STATE_REPOSITORY_PORT) private readonly stateRepo: PipelineStateRepositoryPort,
    @Inject(GLOBAL_ENTITY_MAP_REPOSITORY_PORT) private readonly gemRepo: GlobalEntityMapRepositoryPort,
    @Inject(FIELD_MAPPING_REPOSITORY_PORT) private readonly fieldMappingRepo: FieldMappingRepositoryPort,
    @Inject(SYNC_LOG_REPOSITORY_PORT) private readonly syncLogRepo: SyncLogRepositoryPort,
    @Inject(OUTBOUND_GATEWAY_REPOSITORY_PORT) private readonly outboxRepo: OutboundGatewayRepositoryPort,
  ) {
    this.broker = new PipelineHookBrokerService(this.eventEmitter);
  }

  async processSingleStitch(
    schemaName: string,
    traceId: string,
    dataSourceId: string,
    srcAppName: string,
    appProfile: string,
    srcOrganizationId: string,
    srcEntityId: string | undefined,
    canonicalType: string,
    normalizedData: Record<string, unknown>,
    stitch: ActiveStitch,
    start: number,
    lockRefCount: { count: number },
  ): Promise<void> {
    try {
      const conditions = stitch.syncCondition as Condition[];
      const matched = evaluateConditions(conditions, normalizedData);

      if (!matched) {
        await this.syncLogRepo.writeSyncLog(
          srcOrganizationId,
          schemaName,
          traceId,
          stitch.id,
          "L4",
          "SKIPPED",
          Date.now() - start
        );
        return;
      }

      const mappingRules = await this.fieldMappingRepo.getMappingRules(
        srcOrganizationId,
        stitch.id,
        canonicalType
      );

      if (!mappingRules) {
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
        await this.syncLogRepo.writeSyncLog(
          srcOrganizationId,
          schemaName,
          traceId,
          stitch.id,
          "L4",
          "SKIPPED",
          Date.now() - start
        );
        return;
      }

      let hydratedPayload = await this.targetBuilder.buildPayload(
        schemaName,
        srcAppName,
        appProfile,
        canonicalType,
        srcEntityId,
        normalizedData,
        mappingRules,
      );

      const destConnMeta = await this.connRepo.getTenantConnectionMeta(stitch.destDataSourceId, srcOrganizationId);

      if (!destConnMeta) {
        throw new DependenciesMissingError([
          { entityType: "connection", sourceId: stitch.destDataSourceId },
        ]);
      }

      const destAppName = destConnMeta.appName;
      const destAppProfile = destConnMeta.appProfile;

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
        },
        `[DEBUG] Shard will be resolved as: ${destAppName}/${destAppProfile}`,
      );

      let destEntityId: string | undefined;
      let destState: Record<string, unknown> | undefined;

      if (srcEntityId) {
        const gemDestId = await this.gemRepo.getDestinationEntityId(
          srcOrganizationId,
          stitch.id,
          dataSourceId,
          srcEntityId
        );

        if (gemDestId) {
          destEntityId = gemDestId;
          this.logger.log(
            { event: "l4.debug.gem_hit", traceId, destEntityId },
            `[DEBUG] GEM mapping found — update route, destEntityId=${destEntityId}`,
          );

          try {
            const targetSchemaName = await this.storageResolver.resolveSchemaName(
              stitch.destDataSourceId,
            );
            
            const state = await this.stateRepo.getDestinationEntityState(
              srcOrganizationId,
              targetSchemaName,
              stitch.destDataSourceId,
              stitch.targetObject,
              destEntityId
            );

            if (state) {
              destState = state;
              const debugSyncToken = extractSyncTokenFromState(state as Record<string, unknown>);
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
              `L4: failed to load destState from replica entity: ${sanitizeError(err)}`,
            );
          }
        } else {
          this.logger.log(
            { event: "l4.debug.gem_miss", traceId, srcEntityId },
            `[DEBUG] No GEM mapping found for srcEntityId=${srcEntityId} — create route`,
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

      const destSchemaName = await this.storageResolver.resolveSchemaName(
        stitch.destDataSourceId,
      );
      assertValidSchemaName(destSchemaName);

      const shouldPublish = await this.outboxRepo.upsertPendingOutboundGateway(
        srcOrganizationId,
        destSchemaName,
        traceId,
        stitch.id,
        stitch.destDataSourceId,
        dataSourceId,
        hydratedPayload
      );

      if (shouldPublish) {
        try {
          await this.queueService.send(QueueName.DeliveryQueue, {
            traceId,
            srcDataSourceId: dataSourceId,
            destDataSourceId: stitch.destDataSourceId,
            routeId: stitch.id,
            srcEntityId: srcEntityId ?? null,
            canonicalType,
            srcAppName,
            srcOrganizationId,
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

          await this.outboxRepo.markOutboundGatewayFailed(
            srcOrganizationId,
            destSchemaName,
            traceId,
            stitch.id
          );

          throw sendErr;
        }

        await this.syncLogRepo.writeSyncLog(
          srcOrganizationId,
          schemaName,
          traceId,
          stitch.id,
          "L4",
          "SUCCESS",
          Date.now() - start
        );
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

        const shouldPublishActiveFetch = await this.outboxRepo.upsertDeferredOutboundGateway(
          srcOrganizationId,
          destSchemaName,
          traceId,
          stitch.id,
          stitch.destDataSourceId,
          dataSourceId
        );

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

          await this.syncLogRepo.writeSyncLog(
            srcOrganizationId,
            schemaName,
            traceId,
            stitch.id,
            "L4",
            "SKIPPED",
            Date.now() - start
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
      await this.syncLogRepo.writeSyncLog(
        srcOrganizationId,
        schemaName,
        traceId,
        stitch.id,
        "L4",
        "FAIL",
        Date.now() - start,
        err instanceof Error ? err.message : String(err)
      );
    } finally {
      if (srcEntityId) {
        lockRefCount.count--;
      }
    }
  }
}
