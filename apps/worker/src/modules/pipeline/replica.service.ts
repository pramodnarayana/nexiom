import {
  Injectable,
  Inject,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from "@nestjs/common";
import { QueueService, QueueName } from "@nexiom/queue";
import {
  DATABASE_CONNECTION,
  buildTenantSchema,
  assertValidSchemaName,
  dataSources,
} from "@nexiom/database";
import type { DrizzleDb } from "@nexiom/database";
import {
  StorageResolverService,
  PipelineHookBrokerService,
} from "@nexiom/engine";
import { DependenciesMissingError } from "@nexiom/piece-framework";
import { DB_MANAGER, type TenantDatabaseManager } from "@nexiom/dbmanager";
import { sql, eq, and } from "drizzle-orm";

@Injectable()
export class ReplicaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ReplicaService.name);

  constructor(
    private readonly queueService: QueueService,
    @Inject(DATABASE_CONNECTION) private readonly globalDb: DrizzleDb,
    @Inject(DB_MANAGER) private readonly dbManager: TenantDatabaseManager,
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
      if (passedSchemaName) {
        assertValidSchemaName(passedSchemaName);
      }
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
      const {
        inboundGateway,
        replicaEntity,
        replicaOutbox,
        syncLog,
        activeSyncLocks,
      } = buildTenantSchema(schemaName);

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
      await tenantDb.transaction(async (tx) => {
        assertValidSchemaName(schemaName);
        await tx.execute(
          sql`SET LOCAL search_path TO ${sql.raw('"' + schemaName + '"')}`,
        );

        // Read inbound_gateway payload
        const inboundRows = await tx
          .select()
          .from(inboundGateway)
          .where(sql`${inboundGateway.traceId} = ${traceId}`)
          .limit(1);
        const inbound = inboundRows[0];

        if (!inbound) {
          throw new Error(`Inbound record for traceId ${traceId} not found`);
        }

        if (inbound.status !== "RECEIVED" && inbound.status !== "PENDING") {
          this.logger.debug(
            { traceId, status: inbound.status },
            "L2 already processed this trace (idempotent redelivery). Skipping.",
          );
          return;
        }

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

        const resolvedEntityType = extracted.entityType;
        const resolvedData = extracted.data;

        // ── ACQUIRE ENTITY LOCK ───────────────────────────────────────────────
        // Prevents an UPDATE event from starting while a CREATE event is still
        // in-flight (L2 -> L6), ensuring the UPDATE has access to the GEM mapping.
        try {
          // Self-healing: clear any stale locks that have expired (e.g. from permanently crashed workers)
          await tx
            .delete(activeSyncLocks)
            .where(
              and(
                eq(activeSyncLocks.dataSourceId, dataSourceId),
                eq(activeSyncLocks.entityId, resolvedEntityId),
                sql`${activeSyncLocks.expiresAt} < NOW()`,
              ),
            );

          await tx.insert(activeSyncLocks).values({
            dataSourceId,
            entityId: resolvedEntityId,
            lockedByTraceId: traceId,
            expiresAt: sql`NOW() + INTERVAL '10 minutes'`,
          });
        } catch (err: unknown) {
          if (
            err instanceof Error &&
            (err.message.includes("unique constraint") ||
              err.message.includes("duplicate key"))
          ) {
            // Lock contention — treat as a deferral (retry later), NOT a terminal FAIL
            const lockContentionError = new Error(
              `Entity ${resolvedEntityId} is currently locked by an in-flight sync. ` +
                `Delaying processing to maintain FIFO order.`,
            );
            Object.assign(lockContentionError, { isLockContention: true });
            throw lockContentionError;
          }
          throw err;
        }

        // Upsert into replica_entity keyed on (dataSourceId, entityType, extEntityId).
        // extEntityId is the vendor's stable business ID (e.g. Salesforce Account ID).
        // Multiple webhook deliveries for the same entity converge into one row via ON CONFLICT.
        await tx
          .insert(replicaEntity)
          .values({
            traceId,
            dataSourceId,
            entityType: resolvedEntityType,
            entityId: resolvedEntityId,
            data: resolvedData,
            version: 1,
          })
          .onConflictDoUpdate({
            target: [
              replicaEntity.dataSourceId,
              replicaEntity.entityType,
              replicaEntity.entityId,
            ],
            set: {
              data: resolvedData,
              traceId,
              version: sql`${replicaEntity.version} + 1`,
              updatedAt: sql`NOW()`,
            },
          })
          .returning({ id: replicaEntity.id });

        // Update inbound_gateway status
        await tx
          .update(inboundGateway)
          .set({ status: "REPLICATED" })
          .where(sql`${inboundGateway.id} = ${inbound.id}`);

        // Insert sync_log
        const durationMs = Date.now() - start;
        await tx
          .insert(syncLog)
          .values({
            traceId,
            layer: "L2",
            status: "SUCCESS",
            durationMs,
          })
          .onConflictDoNothing();

        // Atomically write the outbox entry — Debezium CDC watches this table
        // and triggers the relay to ReplicaQueue (via CdcRelayController locally
        // or API Gateway in production). traceId is the consumer deduplication
        // key; if a duplicate is delivered the L3 ON CONFLICT DO NOTHING on
        // replicaId makes it idempotent. onConflictDoNothing guards against
        // InboundQueue message redelivery producing a second outbox row for
        // the same (traceId, dataSourceId).
        await tx
          .insert(replicaOutbox)
          .values({
            traceId,
            dataSourceId,
            status: "PENDING",
          })
          .onConflictDoNothing({
            target: [replicaOutbox.traceId, replicaOutbox.dataSourceId],
          });
      });

      // Best-effort enqueue to L3 bypassing CDC pooling delays and
      // fragile Debezium Docker setups in local dev. Safe due to L3 idempotency.
      await this.queueService
        .send(QueueName.ReplicaQueue, { traceId, dataSourceId })
        .catch((err: unknown) => {
          this.logger.warn(
            {
              event: "l2.enqueue_failed",
              traceId,
              err: err instanceof Error ? err.message : String(err),
            },
            "Failed to best-effort enqueue ReplicaQueue event — relying on CDC",
          );
        });

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

      this.logger.error(
        {
          event: "l2.error",
          traceId,
          err: err instanceof Error ? err.message : String(err),
        },
        "L2 replication failed",
      );

      try {
        const { schemaName, tenantId } =
          await this.storageResolver.resolveStorageProfile(dataSourceId);
        const { syncLog, inboundGateway } = buildTenantSchema(schemaName);
        const tenantDb = await this.dbManager.getTenantDb(tenantId);
        await tenantDb.transaction(async (tx) => {
          assertValidSchemaName(schemaName);
          await tx.execute(
            sql`SET LOCAL search_path TO ${sql.raw('"' + schemaName + '"')}`,
          );

          await tx
            .insert(syncLog)
            .values({
              traceId,
              layer: "L2",
              status: "FAIL",
              durationMs: Date.now() - start,
            })
            .onConflictDoNothing();

          await tx
            .update(inboundGateway)
            .set({ status: "FAIL" })
            .where(sql`${inboundGateway.traceId} = ${traceId}`);
        });
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
