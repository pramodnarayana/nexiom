import { StorageResolverService } from "../storage-resolver/storage-resolver.service.js";
import { sql } from "drizzle-orm";
import { Injectable, Inject, OnModuleInit, Logger } from "@nestjs/common";
import { QueueService, QueueName } from "@soopa/queue";
import { buildTenantSchema, assertValidSchemaName } from "@soopa/database";
import type { DrizzleDb } from "@soopa/database";
import { DB_MANAGER } from "@soopa/dbmanager";
import type { DatabaseManager } from "@soopa/dbmanager";
import { processInChunks } from "../shared/outbox.utils.js";
import {
  sanitizeError,
  isValidPipelineMessage,
  sanitizeErrorObject,
} from "../utils.js";
import { FanoutBatchProcessor } from "./fanout-batch-processor.js";
import { RoutingDecisionEngine } from "./routing-decision.engine.js";

import { CONNECTION_REPOSITORY_PORT, ConnectionRepositoryPort } from "../shared/ports/connection.repository.port.js";
import { PIPELINE_STATE_REPOSITORY_PORT, PipelineStateRepositoryPort } from "../shared/ports/pipeline-state.repository.port.js";
import { STITCH_REPOSITORY_PORT, StitchRepositoryPort } from "../shared/ports/stitch.repository.port.js";
import { TRANSACTION_MANAGER_PORT, TransactionManagerPort } from "../shared/ports/transaction-manager.port.js";

@Injectable()
export class FanoutRouterService implements OnModuleInit {
  private readonly logger = new Logger(FanoutRouterService.name);
  
  constructor(
    private readonly queueService: QueueService,
    private readonly storageResolver: StorageResolverService,
    @Inject(DB_MANAGER) private readonly dbManager: DatabaseManager,
    private readonly batchProcessor: FanoutBatchProcessor,
    private readonly routingDecisionEngine: RoutingDecisionEngine,
    @Inject(CONNECTION_REPOSITORY_PORT) private readonly connRepo: ConnectionRepositoryPort,
    @Inject(PIPELINE_STATE_REPOSITORY_PORT) private readonly stateRepo: PipelineStateRepositoryPort,
    @Inject(STITCH_REPOSITORY_PORT) private readonly stitchRepo: StitchRepositoryPort,
    @Inject(TRANSACTION_MANAGER_PORT) private readonly txManager: TransactionManagerPort,
  ) {}

  onModuleInit() {
    this.queueService.consume(QueueName.NormalizedQueue, async (msg) => {
      await this.processMessage(msg);
    });
  }

  private async processMessage(rawMsg: unknown): Promise<void> {
    const msg = rawMsg as Record<string, unknown>;

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

    const lockRefCount = { count: 0 };

    try {
      const connectionMeta = await this.connRepo.getGlobalConnectionMeta(dataSourceId);
      if (!connectionMeta) {
        throw new Error(`Connection ${dataSourceId} not found in global DB`);
      }

      const tenantId = connectionMeta.tenantId;
      const schemaName = await this.storageResolver.resolveSchemaName(dataSourceId);
      assertValidSchemaName(schemaName);

      let normalizedData: Record<string, unknown> = {};
      let canonicalType = "RAW";
      let srcEntityId: string | undefined;

      const fanoutResult = await this.txManager.runInTenantTransaction(tenantId, schemaName, async (tx) => {
        const entityId = await this.stateRepo.getReplicaSourceVendorId(traceId, schemaName, tx);
        if (!entityId) {
          throw new Error(
            `Replica record not found for GEM threading (traceId=${traceId})`,
          );
        }
        srcEntityId = entityId;

        await tx.execute(sql`
          INSERT INTO ${sql.raw('"' + schemaName + '"')}.active_sync_locks (data_source_id, entity_id, locked_by_trace_id, expires_at)
          VALUES (${dataSourceId}, ${entityId}, ${traceId}, NOW() + INTERVAL '5 minutes')
          ON CONFLICT (data_source_id, entity_id) DO NOTHING
        `);

        await tx.execute(sql`
          SELECT 1 FROM ${sql.raw('"' + schemaName + '"')}.active_sync_locks
          WHERE data_source_id = ${dataSourceId} AND entity_id = ${entityId}
          FOR UPDATE
        `);

        const evaluation = await this.routingDecisionEngine.evaluateSuperseded(
          traceId,
          schemaName,
          tx
        );

        if (evaluation.kind === "superseded") {
          return { kind: "superseded" as const };
        }

        const normalizedObj = await this.stateRepo.getNormalizedData(traceId, schemaName, tx);
        if (!normalizedObj) {
          throw new Error(
            `Normalization row missing for trace ${traceId} after non-superseded evaluation`,
          );
        }

        normalizedData = normalizedObj.data;
        canonicalType = normalizedObj.canonicalType;

        return { kind: "found" as const };
      });

      try {
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

        const stitches = await this.stitchRepo.findActiveStitches(tenantId, dataSourceId, canonicalType);

        if (stitches.length === 0) {
          this.logger.debug(
            { event: "l4.no_routes", traceId, dataSourceId, layer: "L4" },
            "No active stitches found for source connection",
          );
          return;
        }

        const srcConnMeta = await this.connRepo.getTenantConnectionMeta(dataSourceId, tenantId);
        if (!srcConnMeta) {
          throw new Error(
            `Source connection record not found for GEM metadata (dataSourceId=${dataSourceId}, traceId=${traceId})`,
          );
        }

        const srcAppName = srcConnMeta.appName;
        const appProfile = srcConnMeta.appProfile;

        lockRefCount.count = stitches.length;

        const stitchResults = await processInChunks(stitches, 5, (stitch) =>
            this.batchProcessor.processSingleStitch(
              schemaName,
              traceId,
              dataSourceId,
              srcAppName,
              appProfile,
              tenantId,
              srcEntityId,
              canonicalType,
              normalizedData,
              stitch,
              start,
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
        if (srcEntityId) {
          await this.stateRepo.releaseSyncLock(dataSourceId, srcEntityId, schemaName, tenantId);
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
}
