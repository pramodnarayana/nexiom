import { Injectable, Logger, Inject } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ConnectionSchemaProvisionedEvent } from '../connections/events/connection-schema-provisioned.event.js';
import type { DatabaseManager } from '@soopa/dbmanager';
import { DB_MANAGER } from '@soopa/dbmanager';
import { sql } from 'drizzle-orm';

@Injectable()
export class PipelineCdcListener {
  private readonly logger = new Logger(PipelineCdcListener.name);

  constructor(
    @Inject(DB_MANAGER) private readonly dbManager: DatabaseManager,
  ) {}

  @OnEvent('connection.provisioned', { async: true })
  async handleConnectionProvisioned(event: ConnectionSchemaProvisionedEvent) {
    this.logger.log(
      `Registering pipeline CDC tables for schema ${event.schemaName} (dataSource: ${event.dataSourceId})`,
    );

    try {
      const tenantDb = await this.dbManager.getTenantDb(event.tenantId);
      const tables = [
        'inbound_outbox',
        'replica_outbox',
        'normalized_outbox',
        'outbound_outbox',
      ];
      for (const table of tables) {
        await tenantDb.execute(sql`
          DO $$
          BEGIN
            BEGIN
              ALTER PUBLICATION platform_cdc
                ADD TABLE ${sql.identifier(event.schemaName)}.${sql.identifier(table)};
            EXCEPTION WHEN duplicate_object THEN
              -- Ignore gracefully if the table is already in the publication
            END;
          END $$;
        `);
      }
    } catch (error) {
      this.logger.error(
        `Failed to register CDC tables for schema ${event.schemaName}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
