import { BaseOutboxPoller, OutboxTable } from "./base-outbox.poller.js";
import { processInChunks } from "@soopa/pipeline";
import { Injectable, Inject, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { sql } from "drizzle-orm";
import {
  DATABASE_CONNECTION,
  type DrizzleDb,
  globalRegistryOutbox,
} from "@soopa/database";
import { QueueName } from "@soopa/queue";
import { QueueService } from "@soopa/queue";

const BATCH_SIZE = 50;

@Injectable()
export class RegistryOutboxPoller extends BaseOutboxPoller {
  protected readonly logger = new Logger(RegistryOutboxPoller.name);
  private isProcessing = false;

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly globalDb: DrizzleDb,
    protected readonly queueService: QueueService,
  ) {
    super();
  }

  @Cron(CronExpression.EVERY_5_SECONDS)
  async processOutbox(): Promise<void> {
    if (this.isProcessing) {
      this.logger.debug("Skipping processOutbox - already running");
      return;
    }

    this.isProcessing = true;
    try {
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
              WHERE (status = 'PENDING' AND next_retry_at <= NOW())
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

      const results = await processInChunks(claimed, 10, (row) =>
        this.deliverRow(
          this.globalDb,
          "global", // schema name not strictly applicable here
          globalRegistryOutbox as unknown as OutboxTable,
          row,
          QueueName.RegistryReplicationQueue,
          { outboxId: row.id },
          false, // do not mark SUCCESS immediately
        ),
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
    } finally {
      this.isProcessing = false;
    }
  }
}
