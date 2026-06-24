import { Injectable, Inject, OnModuleInit, Logger } from "@nestjs/common";
import { QueueService, QueueName } from "@soopa/queue";
import {
  DB_MANAGER,
  SchemaPlan,
  getWorkspaceSchemaName,
} from "@soopa/dbmanager";
import type { DatabaseManager } from "@soopa/dbmanager";
import type { RegistryReplicationPort } from '../shared/ports/registry-replication.port.js';

@Injectable()
export class RegistryReplicationService implements OnModuleInit {
  private readonly logger = new Logger(RegistryReplicationService.name);

  constructor(
    private readonly queueService: QueueService,
    @Inject("RegistryReplicationPort")
    private readonly registryPort: RegistryReplicationPort,
    @Inject(DB_MANAGER) private readonly dbManager: DatabaseManager,
  ) {}

  onModuleInit() {
    this.queueService.consume(
      QueueName.RegistryReplicationQueue,
      async (rawMsg) => {
        const msg = rawMsg as { outboxId: string };
        if (!msg.outboxId) {
          this.logger.warn(
            "Invalid message received on RegistryReplicationQueue (missing outboxId)",
          );
          return;
        }
        await this.processMessage(msg.outboxId);
      },
    );
  }

  private async processMessage(outboxId: string): Promise<void> {
    try {
      const row = await this.registryPort.fetchGlobalOutboxRecord(outboxId);

      if (!row) {
        this.logger.warn(`Outbox record ${outboxId} not found. Skipping.`);
        return;
      }
      let operationPerformed = false;
      let attempts = 0;
      // Because queue processing is concurrent, messages can arrive out of order.
      // E.g., an INTEGRATION_STITCH might arrive before its parent UI_WORKSPACE.
      // We catch FK violations and retry to give the parent time to be processed.
      const maxAttempts = 10;
      const retryDelayMs = 2000;

      while (attempts < maxAttempts) {
        try {
          if (row.action === "UPSERT" || row.action === "DELETE") {
            await this.registryPort.replicateEntity(
              row.tenantId,
              row.action,
              row.entityType,
              row.entityId,
              row.payload,
            );
            operationPerformed = true;
          }
          break; // Transaction succeeded, break retry loop!
        } catch (err) {
          attempts++;
          const pgErr = err as any;
          const errorCode = pgErr.code || pgErr.cause?.code;
          const isFkViolation =
            errorCode === "23503" ||
            String(err).includes("foreign key constraint") ||
            (pgErr.cause && String(pgErr.cause).includes("foreign key constraint"));

          if (isFkViolation && attempts < maxAttempts) {
            this.logger.warn(
              `Foreign key constraint violation during replication of ${row.entityType} ${row.entityId} ` +
                `to tenant ${row.tenantId}. Retrying in ${retryDelayMs}ms (attempt ${attempts}/${maxAttempts})...`,
            );
            await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
          } else {
            throw err; // Rethrow if it's not a FK violation or we ran out of attempts
          }
        }
      }

      // Throw if no operation was performed (unrecognized action or entityType)
      if (!operationPerformed) {
        throw new Error(
          `Unrecognized registry outbox operation: action="${row.action}", entityType="${row.entityType}"`,
        );
      }

      // Mark outbox as success ONLY after everything (including provisioning) succeeds
      await this.registryPort.markGlobalOutboxSuccess(outboxId);

      this.logger.log(
        `Successfully replicated ${row.entityType} ${row.entityId} to tenant ${row.tenantId}`,
      );
    } catch (err) {
      const pgErr = err as any;
      const errorCode = pgErr.code || pgErr.cause?.code || 'N/A';
      const errorDetail = pgErr.detail || pgErr.cause?.detail || 'N/A';
      const errorHint = pgErr.hint || pgErr.cause?.hint || 'N/A';
      const errorMessage = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Failed to process registry replication for outboxId ${outboxId}. ` +
        `Msg: ${errorMessage}. ` +
        `PG Code: ${errorCode}. ` +
        `PG Detail: ${errorDetail}. ` +
        `PG Hint: ${errorHint}`
      );

      // We don't mark the outbox as FAILED here because the BullMQ retry mechanism will re-queue it,
      // and eventually we will either succeed or let the dead-letter queue handle it.
      // But we must throw so BullMQ registers the failure.
      throw err;
    }
  }
}
