/**
 * inbound_gateway table creation script.
 *
 * Run directly via the DatabaseManager.execSql pattern — no Drizzle generate/migrate.
 *
 * The table lives in the workspace schema (ws_{workspaceId}).
 * Since workspace = connection in Nexiom, there is no connection_id column needed.
 *
 * Usage (from db-cli or a one-off script):
 *   import { createInboundGateway } from './create-inbound-gateway';
 *   await createInboundGateway(client, 'ws_abc123');
 */
import type { Client } from 'pg';

export async function createInboundGateway(
  client: Client,
  schemaName: string, // e.g. 'ws_abc123'
): Promise<void> {
  await client.query(`
        CREATE SCHEMA IF NOT EXISTS "${schemaName}";
    `);

  await client.query(`
        CREATE TABLE IF NOT EXISTS "${schemaName}".inbound_gateway (
            id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
            source_event_id  TEXT        NOT NULL,
            trigger_name     TEXT        NOT NULL,
            app_name         TEXT        NOT NULL,
            object_type      TEXT,
            payload          JSONB       NOT NULL,
            status           TEXT        NOT NULL DEFAULT 'pending',
            trace_id         UUID        NOT NULL DEFAULT gen_random_uuid(),
            created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

            CONSTRAINT uq_inbound_source_event UNIQUE (source_event_id)
        );
    `);

  await client.query(`
        CREATE INDEX IF NOT EXISTS idx_inbound_gateway_status
            ON "${schemaName}".inbound_gateway (status);
    `);

  await client.query(`
        CREATE INDEX IF NOT EXISTS idx_inbound_gateway_object_type
            ON "${schemaName}".inbound_gateway (object_type)
            WHERE object_type IS NOT NULL;
    `);

  await client.query(`
        CREATE INDEX IF NOT EXISTS idx_inbound_gateway_created_at
            ON "${schemaName}".inbound_gateway (created_at DESC);
    `);
}
