import { Injectable, Inject, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { notInArray, eq, sql } from "drizzle-orm";
import { SchemaPlan } from "@nexiom/dbmanager";
import {
  DATABASE_CONNECTION,
  type DrizzleDb,
  buildTenantSchema,
  connectionStorageRegistry,
} from "@nexiom/database";
import { QueueName } from "@nexiom/queue";
import { QueueService } from "@nexiom/queue";
import { processInChunks } from "./outbox.utils.js";

const BATCH_SIZE = 50;
const MAX_ATTEMPTS = 6;

@Injectable()
export class NormalizedOutboxWorker {
  private readonly logger = new Logger(NormalizedOutboxWorker.name);

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb,
    private readonly queueService: QueueService,
  ) {}

  @Cron(CronExpression.EVERY_5_SECONDS)
  async processOutbox(): Promise<void> {
    const workspaces = await this.db
      .select({ dataNamespace: connectionStorageRegistry.dataNamespace })
      .from(connectionStorageRegistry)
      .where(
        notInArray(connectionStorageRegistry.schemaPlan, [
          SchemaPlan.NAMESPACE_ONLY,
        ]),
      )
      .groupBy(connectionStorageRegistry.dataNamespace);

    const results = await processInChunks(
      workspaces,
      5, // Concurrency cap for processing workspaces
      (ws) => this.drainWorkspaceOutbox(ws.dataNamespace),
    );

    results.forEach((result, index) => {
      if (result.status === "rejected") {
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
    const { normalizedOutbox } = buildTenantSchema(schemaName);

    // Atomically claim rows
    const claimed = await this.db.transaction(async (tx) => {
      await tx.execute(
        sql`SET LOCAL search_path TO ${sql.identifier(schemaName)}`,
      );

      return tx
        .update(normalizedOutbox)
        .set({
          status: "PROCESSING",
          attempts: sql`${normalizedOutbox.attempts} + 1`,
          nextRetryAt: sql`NOW() + INTERVAL '5 minutes'`,
        })
        .where(
          sql`${normalizedOutbox.id} IN (
            SELECT id FROM ${sql.identifier(schemaName)}.normalized_outbox
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
      `[${schemaName}] Claimed ${claimed.length} normalized outbox rows`,
    );

    // Process claimed rows
    const results = await processInChunks(
      claimed,
      5, // Concurrency cap array for queue publish ops
      (row) => this.processOutboxRow(schemaName, row),
    );

    results.forEach((result, idx) => {
      if (result.status === "rejected") {
        this.logger.error(
          `[${schemaName}] processOutboxRow critically failed for row id=${claimed[idx].id}: ${
            result.reason instanceof Error
              ? result.reason.message
              : String(result.reason)
          }`,
        );
      }
    });
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
    const { normalizedOutbox } = buildTenantSchema(schemaName);

    let queueSuccess = false;
    try {
      // Send to L4 Queue (NormalizedQueue -> consumed by FanOut)
      // Note: traceId acts as the consumer deduplication key. Duplicate queue
      // messages are harmless because the L4 consumer enforces idempotency
      // via ON CONFLICT DO NOTHING using this traceId/routeId.
      await this.queueService.send(QueueName.NormalizedQueue, {
        traceId: row.traceId,
        connectionId: row.connectionId,
      });
      queueSuccess = true;
    } catch (err) {
      const lastError = err instanceof Error ? err.message : String(err);
      try {
        if (row.attempts >= MAX_ATTEMPTS) {
          await this.db
            .update(normalizedOutbox)
            .set({ status: "FAIL", lastError })
            .where(eq(normalizedOutbox.id, row.id));
          this.logger.error(
            `[${schemaName}] NormalizedOutbox delivery permanently failed for traceId=${row.traceId}: ${lastError}`,
          );
        } else {
          const delayMs = Math.pow(2, row.attempts) * 1_000;
          const nextRetryAt = new Date(Date.now() + delayMs);
          await this.db
            .update(normalizedOutbox)
            .set({ status: "RETRY", lastError, nextRetryAt })
            .where(eq(normalizedOutbox.id, row.id));
          this.logger.warn(
            `[${schemaName}] NormalizedOutbox delivery delayed for traceId=${row.traceId} (attempt ${row.attempts}): ${lastError}`,
          );
        }
      } catch (dbErr) {
        this.logger.error(
          `[${schemaName}] Failed to persist FAIL/RETRY status for normalized_outbox id=${row.id}: ${dbErr instanceof Error ? dbErr.message : String(dbErr)}`,
        );
      }
      return; // Stop processing this row
    }

    if (queueSuccess) {
      try {
        // Mark success
        await this.db
          .update(normalizedOutbox)
          .set({ status: "SUCCESS" })
          .where(eq(normalizedOutbox.id, row.id));

        this.logger.debug(
          `[${schemaName}] Delivered L3->L4 trace=${row.traceId}`,
        );
      } catch (dbErr) {
        const msg = dbErr instanceof Error ? dbErr.message : String(dbErr);
        this.logger.error(
          `[${schemaName}] Published to queue but failed to update status to SUCCESS for normalized_outbox id=${row.id}: ${msg}`,
        );
      }
    }
  }
}
