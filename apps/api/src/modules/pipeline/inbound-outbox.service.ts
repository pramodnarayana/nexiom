import { Injectable, Inject, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { notInArray, sql } from 'drizzle-orm';
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
export class InboundOutboxService {
  private readonly logger = new Logger(InboundOutboxService.name);

  private isProcessingOutbox = false;

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb,
    private readonly queueService: QueueService,
  ) {}

  @Cron(CronExpression.EVERY_5_SECONDS)
  async processOutbox(): Promise<void> {
    if (this.isProcessingOutbox) {
      this.logger.debug(
        'processOutbox already running, skipping this invocation',
      );
      return;
    }

    this.isProcessingOutbox = true;
    try {
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
    } finally {
      this.isProcessingOutbox = false;
    }
  }

  private async drainWorkspaceOutbox(schemaName: string): Promise<void> {
    const { inboundOutbox } = buildTenantSchema(schemaName);

    // Atomically claim rows
    // TODO: The current logic increments attempts at claim time, which counts
    // claim attempts rather than actual delivery failures. Consider adding a
    // separate claim_attempts column in a future schema migration, and only
    // increment attempts in processOutboxRow when a real delivery fails.
    const claimed = await this.db.transaction(async (tx) => {
      await tx.execute(
        sql`SET LOCAL search_path TO ${sql.raw('"' + schemaName + '"')}`,
      );

      return tx
        .update(inboundOutbox)
        .set({
          status: 'PROCESSING',
          attempts: sql`${inboundOutbox.attempts} + 1`,
          nextRetryAt: sql`NOW() + INTERVAL '5 minutes'`,
        })
        .where(
          sql`${inboundOutbox.id} IN (
            SELECT id FROM ${sql.identifier(schemaName)}.inbound_outbox
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
      `[${schemaName}] Claimed ${claimed.length} inbound outbox rows`,
    );

    // Process claimed rows with concurrency limit to avoid overwhelming the queue
    const CONCURRENCY_LIMIT = 10;
    const processWithLimit = async (rows: typeof claimed) => {
      const results: PromiseSettledResult<void>[] = [];
      for (let i = 0; i < rows.length; i += CONCURRENCY_LIMIT) {
        const chunk = rows.slice(i, i + CONCURRENCY_LIMIT);
        const chunkResults = await Promise.allSettled(
          chunk.map((row) => this.processOutboxRow(schemaName, row)),
        );
        results.push(...chunkResults);
      }
      return results;
    };

    const results = await processWithLimit(claimed);

    // Log and handle any rejections (unexpected failures not already caught in processOutboxRow)
    const rejections = results
      .map((r, idx) => ({ result: r, row: claimed[idx] }))
      .filter(({ result }) => result.status === 'rejected');

    if (rejections.length > 0) {
      rejections.forEach(({ result, row }) => {
        this.logger.error(
          `[${schemaName}] Unexpected processOutboxRow failure for traceId=${row.traceId}, id=${row.id}: ${
            result.status === 'rejected'
              ? result.reason instanceof Error
                ? result.reason.message
                : String(result.reason)
              : 'unknown'
          }`,
        );
      });

      throw new Error(
        `[${schemaName}] ${rejections.length} out of ${claimed.length} outbox rows failed to process`,
      );
    }
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
    const { inboundOutbox } = buildTenantSchema(schemaName);

    try {
      // Send to L2 Queue
      await this.queueService.send(QueueName.InboundQueue, {
        traceId: row.traceId,
        connectionId: row.connectionId,
      });

      // Mark success - only if we still own this claim
      await this.db
        .update(inboundOutbox)
        .set({ status: 'SUCCESS' })
        .where(
          sql`${inboundOutbox.id} = ${row.id} AND ${inboundOutbox.status} = 'PROCESSING'`,
        );

      this.logger.debug(
        `[${schemaName}] Delivered L1->L2 trace=${row.traceId}`,
      );
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);

      if (row.attempts >= MAX_ATTEMPTS) {
        await this.db
          .update(inboundOutbox)
          .set({ status: 'FAIL' })
          .where(
            sql`${inboundOutbox.id} = ${row.id} AND ${inboundOutbox.status} = 'PROCESSING'`,
          );
        this.logger.error(
          `[${schemaName}] InboundOutbox delivery permanently failed for traceId=${row.traceId}: ${errorMessage}`,
        );
      } else {
        const delayMs = Math.pow(2, row.attempts) * 1_000;
        const nextRetryAt = new Date(Date.now() + delayMs);

        await this.db
          .update(inboundOutbox)
          .set({ status: 'RETRY', nextRetryAt })
          .where(
            sql`${inboundOutbox.id} = ${row.id} AND ${inboundOutbox.status} = 'PROCESSING'`,
          );
        this.logger.warn(
          `[${schemaName}] InboundOutbox delivery delayed for traceId=${row.traceId} (attempt ${row.attempts}): ${errorMessage}`,
        );
      }
    }
  }
}
