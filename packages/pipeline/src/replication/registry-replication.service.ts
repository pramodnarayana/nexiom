import { Injectable, Inject, OnModuleInit, Logger } from "@nestjs/common";
import { QueueService, QueueName } from "@soopa/queue";
import {
  DB_MANAGER,
  SchemaPlan,
  getWorkspaceSchemaName,
} from "@soopa/dbmanager";
import type { DatabaseManager } from "@soopa/dbmanager";
import type { IRegistryReplicationPort } from "../shared/domain.js";

@Injectable()
export class RegistryReplicationService implements OnModuleInit {
  private readonly logger = new Logger(RegistryReplicationService.name);

  constructor(
    private readonly queueService: QueueService,
    @Inject("IRegistryReplicationPort")
    private readonly registryPort: IRegistryReplicationPort,
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
      // FIELD_MAPPING has a FK dependency on INTEGRATION_STITCH. When both are
      // queued at the same time (e.g. from create-stitch script), the stitch
      // replication message may still be in-flight when the mapping arrives.
      // Give it more retries with a longer backoff to let the parent arrive.
      const maxAttempts = row.entityType === "FIELD_MAPPING" ? 10 : 3;
      const retryDelayMs = row.entityType === "FIELD_MAPPING" ? 2000 : 1000;

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
          const isFkViolation =
            (err as { code?: string })?.code === "23503" ||
            String(err).includes("foreign key constraint");

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

      this.logger.debug(
        `Successfully replicated ${row.entityType} ${row.entityId} to tenant ${row.tenantId}`,
      );
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Failed to process registry replication for outboxId ${outboxId}: ${errorMessage}`,
      );

      // We don't mark the outbox as FAILED here because the BullMQ retry mechanism will re-queue it,
      // and eventually we will either succeed or let the dead-letter queue handle it.
      // But we must throw so BullMQ registers the failure.
      throw err;
    }
  }
}
