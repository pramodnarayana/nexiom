import { QueueName } from "@soopa/queue";
import type {
  OutboxRepositoryPort,
  OutboxRow,
} from "../../ports/outbound/outbox-repository.port.js";
import type { QueuePublisherPort } from "../../ports/outbound/queue-publisher.port.js";
import { Logger } from "@nestjs/common";

export interface ProcessOutboxUseCaseConfig {
  maxAttempts: number;
  batchSize: number;
  queueName: QueueName;
  payloadMapper?: (row: OutboxRow) => unknown;
  markSuccessImmediately?: boolean;
}

export class ProcessOutboxUseCase {
  private readonly logger = new Logger(ProcessOutboxUseCase.name);

  constructor(
    private readonly outboxRepository: OutboxRepositoryPort,
    private readonly queuePublisher: QueuePublisherPort,
    private readonly config: ProcessOutboxUseCaseConfig,
  ) {}

  async execute(tenantId: string, schemaName: string): Promise<void> {
    const rows = await this.outboxRepository.claimNextBatch(
      tenantId,
      schemaName,
      this.config.batchSize,
    );

    if (rows.length === 0) return;

    this.logger.debug(
      `[${schemaName}] Claimed ${rows.length} outbox rows for queue ${this.config.queueName}`,
    );

    const CONCURRENCY_LIMIT = 10;
    for (let i = 0; i < rows.length; i += CONCURRENCY_LIMIT) {
      const chunk = rows.slice(i, i + CONCURRENCY_LIMIT);
      await Promise.allSettled(
        chunk.map((row) => this.processRow(tenantId, schemaName, row)),
      );
    }
  }

  private async processRow(
    tenantId: string,
    schemaName: string,
    row: OutboxRow,
  ): Promise<void> {
    let published = false;
    try {
      const payload = this.config.payloadMapper
        ? this.config.payloadMapper(row)
        : row.payload;

      await this.queuePublisher.send(this.config.queueName, payload);
      published = true;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      await this.handleFailure(tenantId, schemaName, row, errorMessage);
    }

    if (published && this.config.markSuccessImmediately !== false) {
      try {
        await this.outboxRepository.markSuccess(
          tenantId,
          schemaName,
          row.id,
          row.claimToken,
        );
        this.logger.debug(
          `[${schemaName}] Delivered L${this.config.queueName} row=${row.id}`,
        );
      } catch (dbErr) {
        const msg = dbErr instanceof Error ? dbErr.message : String(dbErr);
        this.logger.error(
          `[${schemaName}] Published to queue but failed to update status to SUCCESS for outbox id=${row.id}: ${msg}`,
        );
        throw dbErr;
      }
    }
  }

  private async handleFailure(
    tenantId: string,
    schemaName: string,
    row: OutboxRow,
    errorMessage: string,
  ): Promise<void> {
    const attempts = row.attempts; // attempts represents the attempt number that just failed

    try {
      if (attempts >= this.config.maxAttempts) {
        await this.outboxRepository.markFailed(
          tenantId,
          schemaName,
          row.id,
          errorMessage,
          row.claimToken,
        );
        this.logger.error(
          `[${schemaName}] Outbox delivery permanently failed for row id=${row.id}: ${errorMessage}`,
        );
      } else {
        const delayMs = Math.pow(2, attempts) * 1_000;
        const nextRetryAt = new Date(Date.now() + delayMs);

        await this.outboxRepository.markRetry(
          tenantId,
          schemaName,
          row.id,
          attempts, // Passing attempts (repository can just store it if needed, or row already holds it)
          errorMessage,
          nextRetryAt,
          row.claimToken,
        );
        this.logger.warn(
          `[${schemaName}] Outbox delivery delayed for row id=${row.id} (attempt ${attempts}): ${errorMessage}`,
        );
      }
    } catch (dbErr) {
      this.logger.error(
        `[${schemaName}] Failed to persist FAIL/RETRY status for outbox id=${row.id}: ${dbErr instanceof Error ? dbErr.message : String(dbErr)}`,
      );
      throw dbErr;
    }
  }
}
