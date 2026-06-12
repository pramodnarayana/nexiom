import { Injectable, Inject, Logger } from '@nestjs/common';
import type {
  DatabaseProvisionerPort,
  ProvisionPlanParams,
} from '../../core/ports/outbound/database-provisioner.port.js';
import { DB_MANAGER } from '@soopa/dbmanager';
import type { DatabaseManager } from '@soopa/dbmanager';
import { DATABASE_CONNECTION } from '@soopa/database';
import type { DrizzleDb } from '@soopa/database';
import { sql } from 'drizzle-orm';

@Injectable()
export class PipelineDatabaseProvisionerAdapter implements DatabaseProvisionerPort {
  private readonly logger = new Logger(PipelineDatabaseProvisionerAdapter.name);

  constructor(
    @Inject(DB_MANAGER) private readonly dbManager: DatabaseManager,
    @Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb,
  ) {}

  async applyPlan(params: ProvisionPlanParams): Promise<void> {
    await this.dbManager.applyPlan(
      params.tenantId,
      params.schemaName,
      params.schemaPlan,
      { appName: params.appName, appProfile: params.appProfile },
    );
  }

  async registerPublication(schemaName: string): Promise<void> {
    await this.db.execute(sql`
      DO $$
      BEGIN
        BEGIN
          ALTER PUBLICATION platform_cdc
            ADD TABLE ${sql.raw('"' + schemaName + '"')}.inbound_outbox,
                      ${sql.raw('"' + schemaName + '"')}.replica_outbox,
                      ${sql.raw('"' + schemaName + '"')}.normalized_outbox,
                      ${sql.raw('"' + schemaName + '"')}.outbound_outbox;
        EXCEPTION WHEN duplicate_object THEN
          -- Ignore gracefully if the table is already in the publication
        END;
      END $$;
    `);
  }

  async unregisterPublication(schemaName: string): Promise<void> {
    await this.db.execute(sql`
      DO $$
      BEGIN
        BEGIN
          ALTER PUBLICATION platform_cdc
            DROP TABLE ${sql.raw('"' + schemaName + '"')}.inbound_outbox,
                       ${sql.raw('"' + schemaName + '"')}.replica_outbox,
                       ${sql.raw('"' + schemaName + '"')}.normalized_outbox,
                       ${sql.raw('"' + schemaName + '"')}.outbound_outbox;
        EXCEPTION WHEN undefined_object THEN
          -- Ignore gracefully if the table is not in the publication
        END;
      END $$;
    `);
  }
}
