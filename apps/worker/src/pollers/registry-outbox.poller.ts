import { Injectable, Inject, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import {
  DATABASE_CONNECTION,
  type DrizzleDb,
  globalRegistryOutbox,
} from "@soopa/database";
import { QueueName } from "@soopa/queue";

import { ProcessOutboxUseCase } from "../core/use-cases/outbox/process-outbox.use-case.js";
import {
  DrizzleOutboxRepositoryAdapter,
  type OutboxTableSchema,
} from "../adapters/outbound/drizzle-outbox.repository.js";
import { NestQueuePublisherAdapter } from "../adapters/outbound/nest-queue.publisher.js";

const BATCH_SIZE = 50;

@Injectable()
export class RegistryOutboxPoller {
  private readonly logger = new Logger(RegistryOutboxPoller.name);
  private isProcessing = false;

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly globalDb: DrizzleDb,
    private readonly queuePublisherAdapter: NestQueuePublisherAdapter,
  ) {}

  @Cron(CronExpression.EVERY_5_SECONDS)
  async processOutbox(): Promise<void> {
    if (this.isProcessing) {
      this.logger.debug("Skipping processOutbox - already running");
      return;
    }

    this.isProcessing = true;
    try {
      const repositoryAdapter = new DrizzleOutboxRepositoryAdapter(
        this.globalDb,
        globalRegistryOutbox as unknown as OutboxTableSchema,
      );

      const useCase = new ProcessOutboxUseCase(
        repositoryAdapter,
        this.queuePublisherAdapter,
        {
          batchSize: BATCH_SIZE,
          maxAttempts: 6,
          queueName: QueueName.RegistryReplicationQueue,
          payloadMapper: (row) => ({ outboxId: row.id }),
          markSuccessImmediately: false,
        },
      );

      // We use "global" as schema name because it is the global outbox (no tenant context required)
      await useCase.execute("global", "public");
    } catch (err) {
      this.logger.error(
        `Failed to process registry outbox: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      this.isProcessing = false;
    }
  }
}
