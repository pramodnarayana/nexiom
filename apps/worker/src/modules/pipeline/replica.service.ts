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
  appConnections,
} from "@nexiom/database";
import type { DrizzleDb } from "@nexiom/database";
import { StorageResolverService } from "@nexiom/engine";
import { sql, eq } from "drizzle-orm";
import { getReplicaExtractor } from "@nexiom/piece-framework";

@Injectable()
export class ReplicaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ReplicaService.name);

  constructor(
    private readonly queueService: QueueService,
    @Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb,
    private readonly storageResolver: StorageResolverService,
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
    const connectionId = msg.connectionId as string;
    const start = Date.now();

    this.logger.debug(
      { event: "l2.started", traceId, connectionId },
      "L2 replication started",
    );

    try {
      const passedSchemaName = msg.schemaName as string | undefined;
      if (passedSchemaName) {
        assertValidSchemaName(passedSchemaName);
      }
      const resolvedSchemaName =
        await this.storageResolver.resolveSchemaName(connectionId);
      const schemaName = passedSchemaName ?? resolvedSchemaName;
      if (passedSchemaName && passedSchemaName !== resolvedSchemaName) {
        this.logger.error(
          {
            event: "l2.schema_mismatch",
            traceId,
            connectionId,
            passedSchemaName,
            resolvedSchemaName,
          },
          "Schema name mismatch detected — misrouted CDC event",
        );
        throw new Error(
          `Schema mismatch: msg.schemaName=${passedSchemaName} but resolved=${resolvedSchemaName}`,
        );
      }
      const { inboundGateway, replicaEntity, replicaOutbox, syncLog } =
        buildTenantSchema(schemaName);

      // Fetch application metadata
      const connRows = await this.db
        .select({
          appName: appConnections.appName,
          metadata: appConnections.metadata,
        })
        .from(appConnections)
        .where(eq(appConnections.id, connectionId))
        .limit(1);

      const appName = connRows[0]?.appName;
      const metadata = connRows[0]?.metadata as
        | Record<string, unknown>
        | undefined;

      // Runtime validation of appProfile
      const trimmedAppProfile =
        typeof metadata?.appProfile === "string"
          ? metadata.appProfile.trim()
          : "";
      const appProfile =
        trimmedAppProfile !== "" ? trimmedAppProfile : "default";

      if (!appName) {
        throw new Error(
          `Connection ${connectionId} not found in appConnections!`,
        );
      }

      await this.db.transaction(async (tx) => {
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

        const extractor = getReplicaExtractor(appName, appProfile);

        // If the connection has an explicit appProfile (e.g. "revenova") but no
        // extractor is registered for it, this is a hard misconfiguration — fail
        // loudly rather than silently emitting raw data, which would be invisible
        // until someone notices the replica table looks wrong.
        if (!extractor && appProfile !== "default") {
          throw new Error(
            `No ReplicaExtractor registered for appName="${appName}" appProfile="${appProfile}". ` +
              `Ensure the application package (e.g. @nexiom/application-${appProfile}) is imported in the worker entry point.`,
          );
        }

        // If no extractor is available (appProfile=default), fail early with a clear error
        if (!extractor) {
          throw new Error(
            `No ReplicaExtractor available for traceId ${traceId} (appName="${appName}", appProfile="${appProfile}"). ` +
              `Cannot derive stable entityId from raw payload. ` +
              `Set a valid appProfile on the connection or register a default extractor.`,
          );
        }

        const extracted = extractor(inbound.request);

        if (!extracted) {
          throw new Error(
            `Replica extraction failed for traceId ${traceId}: extractor returned null. ` +
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

        // Upsert into replica_entity keyed on (connectionId, entityType, extEntityId).
        // extEntityId is the vendor's stable business ID (e.g. Salesforce Account ID).
        // Multiple webhook deliveries for the same entity converge into one row via ON CONFLICT.
        await tx
          .insert(replicaEntity)
          .values({
            traceId,
            connectionId,
            entityType: resolvedEntityType,
            entityId: resolvedEntityId,
            data: resolvedData,
            version: 1,
          })
          .onConflictDoUpdate({
            target: [
              replicaEntity.connectionId,
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
        await tx.insert(syncLog).values({
          traceId,
          layer: "L2",
          status: "SUCCESS",
          durationMs,
        });

        // Atomically write the outbox entry — Debezium CDC watches this table
        // and triggers the relay to ReplicaQueue (via CdcRelayController locally
        // or API Gateway in production). traceId is the consumer deduplication
        // key; if a duplicate is delivered the L3 ON CONFLICT DO NOTHING on
        // replicaId makes it idempotent. onConflictDoNothing guards against
        // InboundQueue message redelivery producing a second outbox row for
        // the same (traceId, connectionId).
        await tx
          .insert(replicaOutbox)
          .values({
            traceId,
            connectionId,
            status: "PENDING",
          })
          .onConflictDoNothing({
            target: [replicaOutbox.traceId, replicaOutbox.connectionId],
          });
      });

      // Best-effort enqueue to L3 bypassing CDC pooling delays and
      // fragile Debezium Docker setups in local dev. Safe due to L3 idempotency.
      await this.queueService
        .send(QueueName.ReplicaQueue, { traceId, connectionId })
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
      this.logger.error(
        {
          event: "l2.error",
          traceId,
          err: err instanceof Error ? err.message : String(err),
        },
        "L2 replication failed",
      );

      try {
        const schemaName =
          await this.storageResolver.resolveSchemaName(connectionId);
        const { syncLog, inboundGateway } = buildTenantSchema(schemaName);
        await this.db.transaction(async (tx) => {
          assertValidSchemaName(schemaName);
          await tx.execute(
            sql`SET LOCAL search_path TO ${sql.raw('"' + schemaName + '"')}`,
          );

          await tx.insert(syncLog).values({
            traceId,
            layer: "L2",
            status: "FAIL",
            durationMs: Date.now() - start,
          });

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