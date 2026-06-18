import { Injectable, Inject, Logger } from '@nestjs/common';
import {
  DB_MANAGER,
  SchemaPlan,
  getWorkspaceSchemaName,
} from '@soopa/dbmanager';
import type { DatabaseManager } from '@soopa/dbmanager';
import type { SchemaProvisionerPort } from '../../core/ports/outbound/schema-provisioner.port.js';

@Injectable()
export class DbManagerSchemaProvisionerAdapter implements SchemaProvisionerPort {
  private readonly logger = new Logger(DbManagerSchemaProvisionerAdapter.name);

  constructor(
    @Inject(DB_MANAGER) private readonly dbManager: DatabaseManager,
  ) {}

  async provisionStitchSchemas(
    orgId: string,
    _destDataSourceId: string,
    destAppName: string,
    destEntityanizationId: string,
    destAppProfile?: string,
  ): Promise<void> {
    const schemaName = getWorkspaceSchemaName(
      orgId,
      destAppName,
      destEntityanizationId,
    );
    try {
      await this.dbManager.applyPlan(
        orgId,
        schemaName,
        SchemaPlan.STANDARD_ACTIVE,
        { appName: destAppName, appProfile: destAppProfile || 'standard' },
      );
      this.logger.debug(`Provisioned schema ${schemaName} to STANDARD_ACTIVE`);
    } catch (err) {
      this.logger.error(
        `Failed to provision schema ${schemaName}: ${err instanceof Error ? err.message : String(err)}`,
      );
      // Re-throw — a missing schema would cause immediate pipeline failures.
      throw err;
    }
  }
}
