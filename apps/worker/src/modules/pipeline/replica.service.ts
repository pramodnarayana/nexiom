import {
  Injectable,
  Inject,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from "@nestjs/common";
import { QueueService, QueueName } from "@soopa/queue";
import { DATABASE_CONNECTION, dataSources } from "@soopa/database";
import type { DrizzleDb } from "@soopa/database";
import {
  StorageResolverService,
  PipelineHookBrokerService,
} from "@soopa/engine";
import { DependenciesMissingError } from "@soopa/piece-framework";
import { DB_MANAGER, type TenantDatabaseManager } from "@soopa/dbmanager";
import { eq, and } from "drizzle-orm";
import { sanitizeErrorObject } from "../../shared/pipeline.utils.js";
import type { IReplicaStatePort } from "@soopa/domain-core";

@Injectable()
export class ReplicaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ReplicaService.name);

  constructor(
    private readonly queueService: QueueService,
    @Inject(DATABASE_CONNECTION) private readonly globalDb: DrizzleDb,
    @Inject(DB_MANAGER) private readonly dbManager: TenantDatabaseManager,
    @Inject("IReplicaStatePort")
    private readonly replicaStatePort: IReplicaStatePort,
    private readonly storageResolver: StorageResolverService,
    private readonly hookBroker: PipelineHookBrokerService,
  ) {}

  onModuleInit() {
    this.queueService.consume(QueueName.InboundQueue, async (msg) => {
      await this.processMessage(msg);
    });
  }

  onModuleDestroy() {
    // Queues are gracefully drained by QueueService automatically.
  }

  private async processMessage(rawMsg: unknown): Promise<void> {
    const msg = rawMsg as Record<string, unknown>;
    const traceId = msg.traceId as string;
    const dataSourceId = msg.dataSourceId as string;
    const start = Date.now();

    this.logger.debug(
      { event: "l2.started", traceId, dataSourceId },
      "L2 replication started",
    );

    try {
      const passedSchemaName = msg.schemaName as string | undefined;
      const { schemaName: resolvedSchemaName, tenantId } =
        await this.storageResolver.resolveStorageProfile(dataSourceId);
      const schemaName = passedSchemaName ?? resolvedSchemaName;
      if (passedSchemaName && passedSchemaName !== resolvedSchemaName) {
        this.logger.error(
          {
            event: "l2.schema_mismatch",
            traceId,
            dataSourceId,
            passedSchemaName,
            resolvedSchemaName,
          },
          "Schema name mismatch detected — misrouted CDC event",
        );
        throw new Error(
          `Schema mismatch: msg.schemaName=${passedSchemaName} but resolved=${resolvedSchemaName}`,
        );
      }
      const tenantDb = await this.dbManager.getTenantDb(tenantId);

      // Fetch application metadata
      // dataSources (including metadata.appProfile) lives in the TENANT DB.
      // The global DB only holds tenantId for routing — never full metadata.
      const connMeta = await tenantDb
        .select()
        .from(dataSources)
        .where(
          and(
            eq(dataSources.id, dataSourceId),
            eq(dataSources.tenantId, tenantId),
          ),
        )
        .limit(1)
        .then((rows) => rows[0]);

      if (!connMeta) {
        // Connection not found — treat as retryable to handle replication lag or backfill scenarios
        throw new DependenciesMissingError([
          { entityType: "connection", sourceId: dataSourceId },
        ]);
      }

      const appName = connMeta.appName;
      const appProfile = (connMeta.metadata as Record<string, any>)
        ?.appProfile as string | undefined;

      if (!appProfile) {
        // Missing appProfile — treat as retryable to handle metadata backfill scenarios
        throw new DependenciesMissingError([
          { entityType: "appProfile", sourceId: dataSourceId },
        ]);
      }
      const inbound = await this.replicaStatePort.fetchInboundRecord(
        tenantId,
        schemaName,
        traceId,
      );

      if (!inbound) {
        throw new Error(`Inbound record for traceId ${traceId} not found`);
      }

      if (
        inbound.status !== "RECEIVED" &&
        inbound.status !== "PENDING" &&
        inbound.status !== "FAIL"
      ) {
        this.logger.debug(
          { traceId, status: inbound.status },
          "L2 already processed this trace (idempotent redelivery). Skipping.",
        );
        return;
      }

      // Extraction happens safely OUTSIDE the transaction
      const extracted = await this.hookBroker.extractReplica(
        appName,
        appProfile,
        inbound.request,
      );

      if (!extracted) {
        throw new Error(
          `Replica extraction failed for traceId ${traceId}: shard returned null. ` +
            `Likely the payload is missing the required entity ID (e.g. sf:id).`,
        );
      }

      // Every entity written to replica_entity must carry a stable business ID.
      // A UUID traceId is NOT a valid entityId — it changes with every delivery.
      const resolvedEntityId = extracted.entityId;
      if (!resolvedEntityId) {
        throw new Error(
          `Cannot determine entityId for traceId ${traceId} (appName="${appName}", appProfile="${appProfile}"). ` +
            `Extractor returned null/undefined entityId. Ensure the payload contains a stable business identifier.`,
        );
      }

      const durationMs = Date.now() - start;

      // ── PERSIST REPLICA ───────────────────────────────────────────────
      await this.replicaStatePort.persistReplicaExtraction(
        tenantId,
        schemaName,
        dataSourceId,
        traceId,
        inbound.id,
        {
          entityId: resolvedEntityId,
          entityType: extracted.entityType,
          data: extracted.data,
        },
        durationMs,
      );

      this.logger.log(
        { event: "l2.completed", traceId, durationMs: Date.now() - start },
        "L2 replication completed",
      );
    } catch (err) {
      // Check if this is a lock contention error — if so, treat as retry/defer
      const isLockContention =
        err instanceof Error &&
        "isLockContention" in err &&
        (err as Record<string, unknown>).isLockContention === true;

      if (isLockContention) {
        this.logger.log(
          {
            event: "l2.lock_contention",
            traceId,
            err: err instanceof Error ? err.message : String(err),
          },
          "L2 lock contention detected — deferring to maintain FIFO order",
        );
        // Do NOT mark as FAIL; let the message remain PENDING for retry
        throw err;
      }

      const safeErrStr = err instanceof Error ? err.message : String(err);
      const safeErrObj = sanitizeErrorObject(err);
      this.logger.error(
        {
          event: "l2.error",
          traceId,
          err: safeErrObj,
        },
        `L2 replication failed: ${safeErrStr}`,
      );

      try {
        const { schemaName, tenantId } =
          await this.storageResolver.resolveStorageProfile(dataSourceId);
        const errorMessage = err instanceof Error ? err.message : String(err);
        await this.replicaStatePort.markInboundFail(
          tenantId,
          schemaName,
          traceId,
          err instanceof Error ? `${errorMessage}\n${err.stack}` : errorMessage,
          Date.now() - start,
        );
      } catch (error_) {
        this.logger.error(
          "Failed to write L2 error state",
          error_ instanceof Error ? error_.message : String(error_),
        );
      }
      throw err;
    }
  }
}
