import {
  Injectable,
  Inject,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { QueueService, QueueName } from '@nexiom/queue';
import { StorageResolverService } from '@nexiom/engine';
import { DATABASE_CONNECTION, buildTenantSchema } from '@nexiom/database';
import type { DrizzleDb } from '@nexiom/database';
import { eq, sql, and } from 'drizzle-orm';

interface InboundMessage {
  traceId: string;
  connectionId: string;
}

@Injectable()
export class ReplicaService implements OnModuleInit, OnModuleDestroy {
  constructor(
    @InjectPinoLogger(ReplicaService.name)
    private readonly logger: PinoLogger,
    private readonly queueService: QueueService,
    private readonly storageResolver: StorageResolverService,
    @Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb,
  ) {}

  onModuleInit() {
    this.logger.info('Starting L2 Replica worker...');
    this.queueService.consume(
      QueueName.InboundQueue,
      async (payload: unknown) => {
        if (
          !payload ||
          typeof payload !== 'object' ||
          !('traceId' in payload) ||
          !('connectionId' in payload)
        ) {
          this.logger.warn(
            { msg: payload },
            'Received invalid message from InboundQueue',
          );
          return;
        }
        await this.processMessage(payload as InboundMessage);
      },
      { maxConcurrent: 5 },
    );
  }

  async onModuleDestroy() {
    // Stop consuming to drain the queue before teardown
    await this.queueService.stopConsuming();
  }

  private async processMessage(msg: InboundMessage): Promise<void> {
    const { traceId, connectionId } = msg;

    // Bind L2 pipeline context to structured logging
    this.logger.assign({ layer: 'L2', traceId, connectionId });

    try {
      const schemaName =
        await this.storageResolver.resolveSchemaName(connectionId);
      const { inboundGateway, replicaEntity, syncLog } =
        buildTenantSchema(schemaName);

      const didReplicate = await this.db.transaction(async (tx) => {
        await tx.execute(
          sql`SET LOCAL search_path TO ${sql.raw('"' + schemaName + '"')}`,
        );

        // 1. Atomic grab L1 record
        const updatedRecords = await tx
          .update(inboundGateway)
          .set({ status: 'PROCESSING' })
          .where(
            and(
              eq(inboundGateway.traceId, traceId),
              sql`${inboundGateway.status} != 'REPLICATED'`,
            ),
          )
          .returning();

        const l1Record = updatedRecords[0];

        if (!l1Record) {
          // If no row updated, it might be already REPLICATED or missing
          const [existing] = await tx
            .select()
            .from(inboundGateway)
            .where(eq(inboundGateway.traceId, traceId))
            .limit(1);

          if (!existing) {
            throw new Error(
              `Inbound gateway record not found for traceId ${traceId}`,
            );
          }

          this.logger.debug(`Trace ${traceId} already replicated. Skipping.`);
          return false;
        }

        // 2. Determine entityType and sourceId
        const entityType = l1Record.objectType || 'Unknown';
        let sourceId = l1Record.extReqId;
        const payload = l1Record.payload as Record<string, unknown>;

        if (payload && typeof payload === 'object' && payload !== null) {
          const p = payload;
          if (typeof p.id === 'string' || typeof p.id === 'number') {
            sourceId = String(p.id);
          } else if (typeof p.Id === 'string' || typeof p.Id === 'number') {
            sourceId = String(p.Id);
          } else if (typeof p._id === 'string' || typeof p._id === 'number') {
            sourceId = String(p._id);
          }
        }

        if (!sourceId) {
          sourceId = traceId;
        }

        // 3. UPSERT replica_entity
        await tx
          .insert(replicaEntity)
          .values({
            connectionId,
            traceId,
            srcReqTraceId: l1Record.traceId,
            sourceId,
            entityType,
            data: payload,
          })
          .onConflictDoUpdate({
            target: [
              replicaEntity.connectionId,
              replicaEntity.entityType,
              replicaEntity.sourceId,
            ],
            set: {
              data: payload,
              traceId,
              srcReqTraceId: l1Record.traceId,
              version: sql`${replicaEntity.version} + 1`,
              updatedAt: new Date(),
            },
          });

        // 4. (Removed immediate STATUS='REPLICATED' update here, deferred to outbox confirm)

        // 5. Append to sync_log as PENDING (Outbox pattern)
        const durationMs = Date.now() - new Date(l1Record.createdAt).getTime();
        await tx
          .insert(syncLog)
          .values({
            traceId,
            layer: 'L2',
            status: 'PENDING',
            durationMs,
          })
          .onConflictDoNothing();

        return durationMs;
      });

      if (!didReplicate) {
        return;
      }

      // 6. Push to L3 Normalization Queue
      await this.queueService.send(QueueName.ReplicaQueue, {
        traceId,
        connectionId,
      });

      // 7. Success state update (Confirm Outbox)
      await this.db.transaction(async (tx) => {
        await tx.execute(
          sql`SET LOCAL search_path TO ${sql.raw('"' + schemaName + '"')}`,
        );
        // Mark L1 REPLICATED
        await tx
          .update(inboundGateway)
          .set({ status: 'REPLICATED' })
          .where(eq(inboundGateway.traceId, traceId));
        // Mark syncLog SUCCESS
        await tx
          .update(syncLog)
          .set({ status: 'SUCCESS' })
          .where(and(eq(syncLog.traceId, traceId), eq(syncLog.layer, 'L2')));
      });

      this.logger.info(
        { durationMs: didReplicate },
        `Trace ${traceId} successfully replicated (L2)`,
      );
    } catch (err: unknown) {
      this.logger.error(
        { err: err instanceof Error ? err.stack : String(err) },
        `Failed to process L2 replication for trace ${traceId}`,
      );
      throw err;
    }
  }
}
