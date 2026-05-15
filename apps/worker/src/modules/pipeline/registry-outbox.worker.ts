import { Injectable, Inject, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { eq, sql } from "drizzle-orm";
import {
  DATABASE_CONNECTION,
  type DrizzleDb,
  globalRegistryOutbox,
} from "@nexiom/database";
import { QueueName } from "@nexiom/queue";
import { QueueService } from "@nexiom/queue";
import { processInChunks } from "./outbox.utils.js";

const BATCH_SIZE = 50;
const MAX_ATTEMPTS = 6;

@Injectable()
export class RegistryOutboxWorker {
  private readonly logger = new Logger(RegistryOutboxWorker.name);

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly globalDb: DrizzleDb,
    private readonly queueService: QueueService,
  ) {}

  @Cron(CronExpression.EVERY_5_SECONDS)
  async processOutbox(): Promise<void> {
    try {
      // Atomically claim rows from the global outbox
      const claimed = await this.globalDb.transaction(async (tx) => {
        return tx
          .update(globalRegistryOutbox)
          .set({
            status: "PROCESSING",
            attempts: sql`${globalRegistryOutbox.attempts} + 1`,
            nextRetryAt: sql`NOW() + INTERVAL '5 minutes'`,
          })
          .where(
            sql`${globalRegistryOutbox.id} IN (
              SELECT id FROM ${globalRegistryOutbox}
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

      this.logger.debug(`Claimed ${claimed.length} registry outbox rows`);

      const results = await processInChunks(
        claimed,
        10, // Concurrency cap
        (row) => this.processOutboxRow(row),
      );

      results.forEach((result, idx) => {
        if (result.status === "rejected") {
          this.logger.error(
            `RegistryOutbox processRow critically failed for row id=${claimed[idx].id}: ${
              result.reason instanceof Error
                ? result.reason.message
                : String(result.reason)
            }`,
          );
        }
      });
    } catch (err) {
      this.logger.error(
        `Failed to process registry outbox: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async processOutboxRow(
    row: typeof globalRegistryOutbox.$inferSelect,
  ): Promise<void> {
    let queueSuccess = false;
    try {
      // Send to the dedicated Registry Replication Queue
      await this.queueService.send(QueueName.RegistryReplicationQueue, {
        outboxId: row.id,
      });
      queueSuccess = true;
    } catch (err) {
      const lastError = err instanceof Error ? err.message : String(err);
      try {
        if (row.attempts >= MAX_ATTEMPTS) {
          await this.globalDb
            .update(globalRegistryOutbox)
            .set({ status: "FAILED", lastError })
            .where(eq(globalRegistryOutbox.id, row.id));
          this.logger.error(
            `RegistryOutbox delivery permanently failed for outboxId=${row.id}: ${lastError}`,
          );
        } else {
          const delayMs = Math.pow(2, row.attempts) * 1_000;
          const nextRetryAt = new Date(Date.now() + delayMs);
          await this.globalDb
            .update(globalRegistryOutbox)
            .set({ status: "PENDING", lastError, nextRetryAt }) // Use PENDING for retry, there's no RETRY enum
            .where(eq(globalRegistryOutbox.id, row.id));
          this.logger.warn(
            `RegistryOutbox delivery delayed for outboxId=${row.id} (attempt ${row.attempts}): ${lastError}`,
          );
        }
      } catch (dbErr) {
        this.logger.error(
          `Failed to persist status for global_registry_outbox id=${row.id}: ${dbErr instanceof Error ? dbErr.message : String(dbErr)}`,
        );
      }
      return;
    }

    if (queueSuccess) {
      // Don't mark SUCCESS yet — the ReplicationService will mark it SUCCESS when it actually completes!
      // This guarantees at-least-once delivery semantics in case the queue worker drops the message.
      this.logger.debug(
        `Published registry replication task for outboxId=${row.id}`,
      );
    }
  }
}
