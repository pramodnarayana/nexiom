import {
  Injectable,
  Inject,
  OnModuleInit,
  OnModuleDestroy,
  NotFoundException,
} from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { QueueService, QueueName } from '@nexiom/queue';
import { StorageResolverService } from '@nexiom/engine';
import {
  DATABASE_CONNECTION,
  buildTenantSchema,
  appConnections,
  AppConnectionStatus,
} from '@nexiom/database';
import type { DrizzleDb } from '@nexiom/database';
import { eq, sql, and } from 'drizzle-orm';

interface InboundMessage {
  traceId: string;
  connectionId: string;
}

@Injectable()
export class ReplicaService implements OnModuleInit, OnModuleDestroy {
  constructor(
    private readonly logger: PinoLogger,
    private readonly queueService: QueueService,
    private readonly storageResolver: StorageResolverService,
    @Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb,
  ) {
    this.logger.setContext(ReplicaService.name);
  }

  onModuleInit() {
    this.logger.info('Starting L2 Replica worker...');
    this.queueService.consume(
      QueueName.InboundQueue,
      async (payload: unknown) => {
        if (
          !payload ||
          typeof payload !== 'object' ||
          !('traceId' in payload) ||
          !('connectionId' in payload) ||
          typeof (payload as Record<string, unknown>).traceId !== 'string' ||
          typeof (payload as Record<string, unknown>).connectionId !== 'string'
        ) {
          let safePayload = '[unserializable payload]';
          try {
            safePayload = JSON.stringify(payload);
          } catch {
            // fallback for circular refs
          }
          this.logger.warn(
            { payload: safePayload },
            'Received invalid message from InboundQueue: traceId and connectionId must be strings.',
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

    try {
      const activeCheck = await this.db
        .select({ id: appConnections.id })
        .from(appConnections)
        .where(
          and(
            eq(appConnections.id, connectionId),
            eq(appConnections.status, AppConnectionStatus.ACTIVE),
          ),
        )
        .limit(1);

      if (activeCheck.length === 0) {
        throw new NotFoundException(
          `Connection ${connectionId} is not ACTIVE or does not exist`,
        );
      }

      const schemaName =
        await this.storageResolver.resolveSchemaName(connectionId);
      const { inboundGateway, replicaEntity, syncLog, replicaOutbox } =
        buildTenantSchema(schemaName);

      const didReplicate = await this.db.transaction(async (tx) => {
        await tx.execute(
          sql`SET LOCAL search_path TO ${sql.identifier(schemaName)}`,
        );

        // 1. Atomic grab L1 record
        const updatedRecords = await tx
          .update(inboundGateway)
          .set({ status: 'PROCESSING' })
          .where(
            and(
              eq(inboundGateway.traceId, traceId),
              eq(inboundGateway.status, 'RECEIVED'),
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

          this.logger.debug(
            { connectionId, traceId },
            'Trace already replicated. Skipping.',
          );
          return { replicated: false, durationMs: 0 };
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

        // 4. Mark L1 as REPLICATED immediately in THIS transaction
        await tx
          .update(inboundGateway)
          .set({ status: 'REPLICATED' })
          .where(eq(inboundGateway.traceId, traceId));

        // 5. Audit syncLog as SUCCESS (no more PENDING phase)
        const durationMs = Date.now() - new Date(l1Record.createdAt).getTime();
        await tx
          .insert(syncLog)
          .values({
            traceId,
            layer: 'L2',
            status: 'SUCCESS',
            durationMs,
          })
          .onConflictDoNothing();

        // 6. Insert into Transactional Outbox (decouples DB commit from Queue network hop)
        await tx.insert(replicaOutbox).values({
          traceId,
          connectionId,
          status: 'PENDING',
        });

        return { replicated: true, durationMs };
      });

      if (!didReplicate?.replicated) {
        return;
      }

      // 7. No external queueing logic needed here - Outbox worker handles this relay

      this.logger.info(
        {
          traceId,
          connectionId,
          layer: 'L2',
          durationMs: didReplicate.durationMs,
        },
        'Trace successfully replicated (L2)',
      );
    } catch (err: unknown) {
      this.logger.error(
        { err, traceId, connectionId, layer: 'L2' },
        'Failed to process L2 replication for trace',
      );
      throw err;
    }
  }
}
