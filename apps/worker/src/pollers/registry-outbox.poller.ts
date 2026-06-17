import { Injectable, Inject, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import {
  DATABASE_CONNECTION,
  type DrizzleDb,
  globalRegistryOutbox,
} from "@soopa/database";
import { QueueName } from "@soopa/queue";

import { ProcessOutboxUseCase } from "../core/use-cases/outbox/process-outbox.use-case.js";
import { ENTITY_TYPE_CONFIG_MAP } from "./registry-outbox.routing.js";
import {
  DrizzleOutboxRepositoryAdapter,
  type OutboxTableSchema,
} from "../adapters/outbound/drizzle-outbox.repository.js";
import { NestQueuePublisherAdapter } from "../adapters/outbound/nest-queue.publisher.js";
import type { OutboxRow } from "../core/ports/outbound/outbox-repository.port.js";

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
          queueName: (row: OutboxRow) => {
            const outboxRow = row as OutboxRow & {
              entityType?: string;
              entity_type?: string;
            };
            const type = (outboxRow.entityType ||
              outboxRow.entity_type) as string;
            this.logger.debug(
              `OUTBOX ROW IN POLLER: ${JSON.stringify(outboxRow)}`,
            );
            this.logger.debug(`RESOLVED TYPE: ${type}`);
            return (
              ENTITY_TYPE_CONFIG_MAP[type]?.queueName ||
              QueueName.RegistryReplicationQueue
            );
          },
          payloadMapper: (row) => ({ outboxId: row.id }),
          markSuccessImmediately: false,
          onPermanentFailure: async (row) => {
            const outboxRow = row as OutboxRow & {
              entityType?: string;
              entity_type?: string;
            };
            const type = (outboxRow.entityType ||
              outboxRow.entity_type) as string;
            const handler = ENTITY_TYPE_CONFIG_MAP[type]?.onPermanentFailure;
            if (handler) {
              await handler(row, this.globalDb);
            }
          },
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
