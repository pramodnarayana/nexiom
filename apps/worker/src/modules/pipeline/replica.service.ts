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
} from "@nexiom/database";
import type { DrizzleDb } from "@nexiom/database";
import { StorageResolverService } from "@nexiom/engine";
import { sql } from "drizzle-orm";

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
      const schemaName =
        await this.storageResolver.resolveSchemaName(connectionId);
      const { inboundGateway, replicaEntity, replicaOutbox, syncLog } =
        buildTenantSchema(schemaName);

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

        const entityType = inbound.objectType || "DEFAULT";
        if (!inbound.extReqId) {
          throw new Error(
            `Inbound record for traceId ${traceId} is missing extReqId. A stable external identity is required for idempotency.`,
          );
        }
        const sourceId = inbound.extReqId;

        // Upsert into replica_entity
        await tx
          .insert(replicaEntity)
          .values({
            traceId, // Current trace ID resolving the replica
            connectionId,
            srcReqTraceId: inbound.traceId, // The L1 message trace
            entityType,
            sourceId,
            data: inbound.payload as any,
            version: 1,
          })
          .onConflictDoUpdate({
            target: [
              replicaEntity.connectionId,
              replicaEntity.entityType,
              replicaEntity.sourceId,
            ],
            set: {
              data: inbound.payload as any,
              traceId, // Update traceId to the latest run
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

        // Atomically write the outbox entry — the ReplicaOutboxService sweeper
        // (in apps/api) will deliver this to ReplicaQueue with retries.
        // traceId is the consumer deduplication key; if a duplicate is delivered
        // the L3 ON CONFLICT DO NOTHING on replicaId makes it idempotent.
        await tx.insert(replicaOutbox).values({
          traceId,
          connectionId,
          status: "PENDING",
        });
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
