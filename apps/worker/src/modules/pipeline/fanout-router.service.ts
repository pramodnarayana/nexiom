import { Injectable, Inject, OnModuleInit, Logger } from "@nestjs/common";
import { eq, and, sql } from "drizzle-orm";
import { QueueService, QueueName } from "@soopa/queue";
import {
  DATABASE_CONNECTION,
  buildTenantSchema,
  assertValidSchemaName,
  integrationStitches,
  dataSources,
  uiWorkspaceDataSources,
} from "@soopa/database";
import type { DrizzleDb } from "@soopa/database";
import { StorageResolverService } from "@soopa/engine";
import { DB_MANAGER } from "@soopa/dbmanager";
import type { DatabaseManager } from "@soopa/dbmanager";
import { processInChunks } from "./outbox.utils.js";
import {
  sanitizeError,
  isValidPipelineMessage,
  sanitizeErrorObject,
} from "../../shared/pipeline.utils.js";
import { FanoutBatchProcessor } from "./fanout-batch-processor.js";

@Injectable()
export class FanoutRouterService implements OnModuleInit {
  private readonly logger = new Logger(FanoutRouterService.name);
  constructor(
    private readonly queueService: QueueService,
    @Inject(DATABASE_CONNECTION) private readonly globalDb: DrizzleDb,
    private readonly storageResolver: StorageResolverService,
    @Inject(DB_MANAGER) private readonly dbManager: DatabaseManager,
    private readonly batchProcessor: FanoutBatchProcessor,
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

      let normalizedData: Record<string, unknown> = {};
      let canonicalType = "RAW";
      let srcVendorId: string | undefined;

      const fanoutResult = await tenantDb.transaction(async (tx) => {
        assertValidSchemaName(schemaName);
        await tx.execute(
          sql`SET LOCAL search_path TO ${sql.raw('"' + schemaName + '"')}`,
        );

        const normRows = await tx
          .select()
          .from(normalizedEntity)
          .where(sql`${normalizedEntity.traceId} = ${traceId}`)
          .limit(1);

        if (!normRows.length) {
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

      const stitches = await tenantDb
        .select({
          id: integrationStitches.id,
          name: integrationStitches.name,
          orgId: integrationStitches.orgId,
          workspaceId: integrationStitches.workspaceId,
          destDataSourceId: integrationStitches.destDataSourceId,
          canonicalObject: integrationStitches.canonicalObject,
          targetObject: integrationStitches.targetObject,
          syncCondition: integrationStitches.syncCondition,
          status: integrationStitches.status,
          createdAt: integrationStitches.createdAt,
          updatedAt: integrationStitches.updatedAt,
        })
        .from(integrationStitches)
        .innerJoin(
          uiWorkspaceDataSources,
          and(
            eq(
              integrationStitches.workspaceId,
              uiWorkspaceDataSources.workspaceId,
            ),
            eq(uiWorkspaceDataSources.dataSourceId, dataSourceId),
          ),
        )
        .where(
          sql`${integrationStitches.canonicalObject} = ${canonicalType} AND ${integrationStitches.status} = 'ACTIVE'`,
        );

      if (stitches.length === 0) {
        this.logger.debug(
          { event: "l4.no_routes", traceId, dataSourceId, layer: "L4" },
          "No active stitches found for source connection",
        );
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

      const trimmedAppProfile =
        typeof metadata?.appProfile === "string"
          ? metadata.appProfile.trim()
          : "";
      const appProfile =
        trimmedAppProfile !== "" ? trimmedAppProfile : "standard";

      lockRefCount.count = stitches.length;

      try {
        const stitchResults = await processInChunks(stitches, 5, (stitch) =>
          this.batchProcessor.processSingleStitch(
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
