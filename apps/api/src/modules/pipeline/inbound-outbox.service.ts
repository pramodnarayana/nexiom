import { Injectable, Inject, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { sql } from 'drizzle-orm';
import {
  DATABASE_CONNECTION,
  type DrizzleDb,
  buildTenantSchema,
  tenantStorageRegistry,
  appConnections,
} from '@nexiom/database';
import { QueueName } from '@nexiom/queue';
import { QueueService } from '@nexiom/queue';
import { getWorkspaceSchemaName } from '@nexiom/dbmanager';
import type { DatabaseManager } from '@nexiom/dbmanager';
import { DB_MANAGER } from '../dbmanager/dbmanager.module.js';

const BATCH_SIZE = 50;
const MAX_ATTEMPTS = 6;

@Injectable()
export class InboundOutboxService {
  private readonly logger = new Logger(InboundOutboxService.name);

  private isProcessingOutbox = false;

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly globalDb: DrizzleDb,
    private readonly queueService: QueueService,
    @Inject(DB_MANAGER) private readonly dbManager: DatabaseManager,
  ) {}

  @Cron(CronExpression.EVERY_5_SECONDS)
  async processOutbox(): Promise<void> {
    try {
      const tenants = await this.globalDb.select().from(tenantStorageRegistry);
      if (tenants.length === 0) return;

      await Promise.allSettled(
        tenants.map(async (tenant) => {
          try {
            const tenantDb = await this.dbManager.getTenantDb(tenant.tenantId);
            const connections = await tenantDb.select().from(appConnections);

            for (const connection of connections) {
              const schemaName = getWorkspaceSchemaName(
                connection.id,
                connection.appName,
              );
              try {
                await this.drainWorkspaceOutbox(tenantDb, schemaName);
              } catch (schemaErr) {
                this.logger.error(
                  `[${tenant.tenantId}] Failed to drain inbound outbox for schema ${schemaName}: ${schemaErr instanceof Error ? schemaErr.message : String(schemaErr)}`,
                );
              }
            }
          } catch (tenantErr) {
            this.logger.error(
              `Failed to process inbound outbox for tenant ${tenant.tenantId}: ${tenantErr instanceof Error ? tenantErr.message : String(tenantErr)}`,
            );
          }
        }),
      );
    } catch (err) {
      this.logger.error(
        `Failed to query global tenant registry for inbound outbox: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async drainWorkspaceOutbox(
    tenantDb: DrizzleDb,
    schemaName: string,
  ): Promise<void> {
    const { inboundOutbox } = buildTenantSchema(schemaName);

    // Atomically claim rows
    // TODO: The current logic increments attempts at claim time, which counts
    // claim attempts rather than actual delivery failures. Consider adding a
    // separate claim_attempts column in a future schema migration, and only
    // increment attempts in processOutboxRow when a real delivery fails.
    const claimed = await tenantDb.transaction(async (tx) => {
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
          sql`(${inboundOutbox.id}, ${inboundOutbox.attempts}) IN (
            SELECT id, attempts FROM ${sql.identifier(schemaName)}.inbound_outbox
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
          chunk.map((row) => this.processOutboxRow(tenantDb, schemaName, row)),
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
    }
  }

  private async processOutboxRow(
    tenantDb: DrizzleDb,
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
      await tenantDb
        .update(inboundOutbox)
        .set({ status: 'SUCCESS', lastError: null })
        .where(
          sql`${inboundOutbox.id} = ${row.id} AND ${inboundOutbox.status} = 'PROCESSING' AND ${inboundOutbox.attempts} = ${row.attempts}`,
        );

      this.logger.debug(
        `[${schemaName}] Delivered L1->L2 trace=${row.traceId}`,
      );
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);

      if (row.attempts >= MAX_ATTEMPTS) {
        await tenantDb
          .update(inboundOutbox)
          .set({ status: 'FAIL', lastError: errorMessage })
          .where(
            sql`${inboundOutbox.id} = ${row.id} AND ${inboundOutbox.status} = 'PROCESSING' AND ${inboundOutbox.attempts} = ${row.attempts}`,
          );
        this.logger.error(
          `[${schemaName}] InboundOutbox delivery permanently failed for traceId=${row.traceId}: ${errorMessage}`,
        );
      } else {
        const delayMs = Math.pow(2, row.attempts) * 1_000;
        const nextRetryAt = new Date(Date.now() + delayMs);

        await tenantDb
          .update(inboundOutbox)
          .set({ status: 'RETRY', nextRetryAt, lastError: errorMessage })
          .where(
            sql`${inboundOutbox.id} = ${row.id} AND ${inboundOutbox.status} = 'PROCESSING' AND ${inboundOutbox.attempts} = ${row.attempts}`,
          );
        this.logger.warn(
          `[${schemaName}] InboundOutbox delivery delayed for traceId=${row.traceId} (attempt ${row.attempts}): ${errorMessage}`,
        );
      }
    }
  }
}
