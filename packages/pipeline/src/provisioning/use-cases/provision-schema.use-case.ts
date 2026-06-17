import { Logger } from '@nestjs/common';
import type { RegistryReplicationPort } from '../../shared/domain.js';
import type { DatabaseManager, SchemaPlan } from '@soopa/dbmanager';

export interface ProvisionSchemaCommand {
  outboxId: string;
}

export class ProvisionSchemaUseCase {
  private readonly logger = new Logger(ProvisionSchemaUseCase.name);

  constructor(
    private readonly registryPort: RegistryReplicationPort,
    private readonly dbManager: DatabaseManager,
  ) {}

  async execute(command: ProvisionSchemaCommand): Promise<void> {
    const row = await this.registryPort.fetchGlobalOutboxRecord(command.outboxId);

    if (!row) {
      return;
    }

    if (row.entityType as string === 'SCHEMA_PROVISION' && row.action as string === 'APPLY') {
      const payload = row.payload as {
        plan: SchemaPlan;
        schemaName: string;
        appName: string;
        appProfile: string;
      };

      await this.dbManager.applyPlan(
        row.tenantId,
        payload.schemaName,
        payload.plan,
        {
          appName: payload.appName,
          appProfile: payload.appProfile,
        },
      );

      // Update connection status to ACTIVE now that schema is fully provisioned
      if (row.entityId) {
        await this.registryPort.markConnectionStatus(row.tenantId, row.entityId, 'ACTIVE');
      }

      this.logger.debug(
        `Successfully provisioned schema ${payload.schemaName} for connection ${row.entityId} in tenant ${row.tenantId}`,
      );

      await this.registryPort.markGlobalOutboxSuccess(command.outboxId);
    } else {
      throw new Error(
        `Unexpected outbox row type or action: entityType=${row.entityType}, action=${row.action}`,
      );
    }
  }
}
