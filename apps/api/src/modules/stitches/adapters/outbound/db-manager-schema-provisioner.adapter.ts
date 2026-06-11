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
    destDataSourceId: string,
    destAppName: string,
    destAppProfile?: string,
  ): Promise<void> {
    const pairs = [{ dataSourceId: destDataSourceId, appName: destAppName }];
    await Promise.all(
      pairs.map(async ({ dataSourceId, appName }) => {
        const schemaName = getWorkspaceSchemaName(dataSourceId, appName);
        try {
          await this.dbManager.applyPlan(
            orgId,
            schemaName,
            SchemaPlan.OUTBOUND_ACTIVE,
            { appName, appProfile: destAppProfile || 'standard' },
          );
          this.logger.debug(
            `Provisioned schema ${schemaName} to OUTBOUND_ACTIVE`,
          );
        } catch (err) {
          this.logger.error(
            `Failed to provision schema ${schemaName}: ${err instanceof Error ? err.message : String(err)}`,
          );
          // Re-throw — a missing schema would cause immediate pipeline failures.
          throw err;
        }
      }),
    );
  }
}
