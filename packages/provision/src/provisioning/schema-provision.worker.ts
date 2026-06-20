import { Injectable, Inject, OnModuleInit, Logger } from '@nestjs/common';
import { QueueService, QueueName } from '@soopa/queue';
import { DB_MANAGER } from '@soopa/dbmanager';
import type { DatabaseManager } from '@soopa/dbmanager';
import type { RegistryReplicationPort } from '../shared/ports/registry-replication.port.js';
import { ProvisionSchemaUseCase } from './use-cases/provision-schema.use-case.js';

@Injectable()
export class SchemaProvisionWorker implements OnModuleInit {
  private readonly logger = new Logger(SchemaProvisionWorker.name);
  private readonly useCase: ProvisionSchemaUseCase;

  constructor(
    private readonly queueService: QueueService,
    @Inject('RegistryReplicationPort')
    registryPort: RegistryReplicationPort,
    @Inject(DB_MANAGER) dbManager: DatabaseManager,
  ) {
    this.useCase = new ProvisionSchemaUseCase(registryPort, dbManager);
  }

  onModuleInit() {
    this.queueService.consume(
      QueueName.SchemaProvisionQueue as QueueName,
      async (rawMsg) => {
        const msg = rawMsg as { outboxId: string };
        if (!msg.outboxId) {
          this.logger.warn(
            'Invalid message received on SchemaProvisionQueue (missing outboxId)',
          );
          return;
        }

        try {
          await this.useCase.execute({ outboxId: msg.outboxId });
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : String(err);
          this.logger.error(
            `Failed to process schema provision for outboxId ${msg.outboxId}: ${errorMessage}`,
          );
          throw err;
        }
      },
    );
  }
}
