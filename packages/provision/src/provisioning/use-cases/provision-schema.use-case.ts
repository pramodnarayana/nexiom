import { Logger } from '@nestjs/common';
import type { RegistryReplicationPort } from '../../shared/ports/registry-replication.port.js';
import type { DatabaseManager, SchemaPlan } from '@soopa/dbmanager';

import type { DomainProvisionerPort } from '../ports/domain-provisioner.port.js';

export interface ProvisionSchemaCommand {
  outboxId: string;
}

export class ProvisionSchemaUseCase {
  private readonly logger = new Logger(ProvisionSchemaUseCase.name);

  constructor(
    private readonly registryPort: RegistryReplicationPort,
    private readonly dbManager: DatabaseManager,
    private readonly domainProvisioner: DomainProvisionerPort,
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

      // 1. Provision Pipeline tables via DB Manager
      await this.dbManager.applyPlan(
        row.tenantId,
        payload.schemaName,
        payload.plan
      );

      // 2. Provision Domain tables via the dynamic Plugin Registry Adapter
      await this.domainProvisioner.provisionDomainSchema(
        row.tenantId,
        payload.schemaName,
        payload.appName
      );

      // Enterprise Grade: Register CDC publication inside the worker after schema exists
      await this.registryPort.registerCdcTables(row.tenantId, payload.schemaName);

      // Update connection status to ACTIVE now that schema is fully provisioned
      if (row.entityId) {
        await this.registryPort.activateConnection(row.tenantId, row.entityId, payload.plan);
      }

      this.logger.log(
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
