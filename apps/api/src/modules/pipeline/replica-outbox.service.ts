import { Injectable, Inject, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { notInArray, eq, sql } from 'drizzle-orm';
import { SchemaPlan } from '@nexiom/dbmanager';
import {
  DATABASE_CONNECTION,
  type DrizzleDb,
  buildTenantSchema,
  connectionStorageRegistry,
} from '@nexiom/database';
import { QueueName } from '@nexiom/queue';
import { QueueService } from '@nexiom/queue';

const BATCH_SIZE = 50;
const MAX_ATTEMPTS = 6;

@Injectable()
export class ReplicaOutboxService {
  private readonly logger = new Logger(ReplicaOutboxService.name);

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb,
    private readonly queueService: QueueService,
  ) {}

  @Cron(CronExpression.EVERY_5_SECONDS)
  async processOutbox(): Promise<void> {
    // 1. Fetch all unique schema names (workspaces)
    const workspaces = await this.db
      .select({ dataNamespace: connectionStorageRegistry.dataNamespace })
      .from(connectionStorageRegistry)
      .where(
        notInArray(connectionStorageRegistry.schemaPlan, [
          SchemaPlan.NAMESPACE_ONLY,
        ]),
      )
      .groupBy(connectionStorageRegistry.dataNamespace);

    const results = await Promise.allSettled(
      workspaces.map((ws) => this.drainWorkspaceOutbox(ws.dataNamespace)),
    );

    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        this.logger.error(
          `[${workspaces[index].dataNamespace}] drainWorkspaceOutbox failed: ${
            result.reason instanceof Error
              ? result.reason.message
              : String(result.reason)
          }`,
        );
      }
    });
  }

  private async drainWorkspaceOutbox(schemaName: string): Promise<void> {
    const { replicaOutbox } = buildTenantSchema(schemaName);

    // Atomically claim rows
    const claimed = await this.db.transaction(async (tx) => {
      await tx.execute(
        sql`SET LOCAL search_path TO ${sql.raw('"' + schemaName + '"')}`,
      );

      return tx
        .update(replicaOutbox)
        .set({
          status: 'PROCESSING',
          attempts: sql`${replicaOutbox.attempts} + 1`,
          nextRetryAt: sql`NOW() + INTERVAL '5 minutes'`,
        })
        .where(
          sql`${replicaOutbox.id} IN (
            SELECT id FROM ${sql.identifier(schemaName)}.replica_outbox
            WHERE status = 'PENDING' 
               OR (status = 'RETRY' AND next_retry_at <= NOW())
               OR (status = 'PROCESSING' AND next_retry_at <= NOW())
            ORDER BY next_retry_at ASC
            LIMIT ${BATCH_SIZE}
            FOR UPDATE SKIP LOCKED
          )`,
        )
        .returning();
    });

    if (claimed.length === 0) return;

    this.logger.debug(
      `[${schemaName}] Claimed ${claimed.length} replica outbox rows`,
    );

    // Process claimed rows
    await Promise.allSettled(
      claimed.map((row) => this.processOutboxRow(schemaName, row)),
    );
  }

  private async processOutboxRow(
    schemaName: string,
    row: {
      id: string;
      traceId: string;
      connectionId: string;
      attempts: number;
    },
  ): Promise<void> {
    const { replicaOutbox } = buildTenantSchema(schemaName);

    try {
      // Send to L3 Queue
      await this.queueService.send(QueueName.ReplicaQueue, {
        traceId: row.traceId,
        connectionId: row.connectionId,
      });

      // Mark success
      await this.db
        .update(replicaOutbox)
        .set({ status: 'SUCCESS' })
        .where(eq(replicaOutbox.id, row.id));

      this.logger.debug(
        `[${schemaName}] Delivered L2->L3 trace=${row.traceId}`,
      );
    } catch (err) {
      const lastError = err instanceof Error ? err.message : String(err);

      if (row.attempts >= MAX_ATTEMPTS) {
        await this.db
          .update(replicaOutbox)
          .set({ status: 'FAIL', lastError })
          .where(eq(replicaOutbox.id, row.id));
        this.logger.error(
          `[${schemaName}] ReplicaOutbox delivery permanently failed for traceId=${row.traceId}: ${lastError}`,
        );
      } else {
        const delayMs = Math.pow(2, row.attempts) * 1_000;
        const nextRetryAt = new Date(Date.now() + delayMs);

        await this.db
          .update(replicaOutbox)
          .set({ status: 'RETRY', lastError, nextRetryAt })
          .where(eq(replicaOutbox.id, row.id));
        this.logger.warn(
          `[${schemaName}] ReplicaOutbox delivery delayed for traceId=${row.traceId} (attempt ${row.attempts}): ${lastError}`,
        );
      }
    }
  }
}
