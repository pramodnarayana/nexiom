import type { DatabaseManager } from '../interfaces.js';
import { SchemaPlan } from '../interfaces.js';
import type { DrizzleDb } from '@nexiom/database';
import { createHash } from 'node:crypto';

const SAFE_SCHEMA_NAME_RE = /^ws_[a-z0-9_]+$/;

export class SqlDatabaseManager implements DatabaseManager {
    constructor(private readonly db: DrizzleDb) { }

    private validateSchemaName(name: string): void {
        if (!SAFE_SCHEMA_NAME_RE.test(name)) {
            throw new Error(
                `Invalid schemaName (sha256 prefix: ${createHash('sha256').update(name).digest('hex').slice(0, 8)}…) — ` +
                `expected format: ws_{workspaceId} with only lowercase letters, digits, and underscores after the prefix.`,
            );
        }
    }

    async applyPlan(schemaName: string, plan: SchemaPlan): Promise<void> {
        this.validateSchemaName(schemaName);

        // 1. Always ensure namespace exists (Minimum baseline for all plans)
        await this.db.$client.query(
            `CREATE SCHEMA IF NOT EXISTS "${schemaName}";`,
        );

        if (plan === SchemaPlan.NAMESPACE_ONLY) {
            return;
        }

        // 2. Ensure Gateway Tables exist
        await this.provisionGatewayTables(schemaName);

        if (plan === SchemaPlan.GATEWAY_ACTIVE) {
            return;
        }

        // 3. (Future) Ensure Replica Tables exist
        // TODO: implement provisionReplicaTables(schemaName) before enabling REPLICA_ACTIVE in production
        if (plan === SchemaPlan.REPLICA_ACTIVE) {
            return;
        }
    }

    private async provisionGatewayTables(schemaName: string): Promise<void> {
        // We execute these independently so that they are idempotent.
        // If they error, the whole task fails, preventing partial corruption.
        await this.db.$client.query(`
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

        await this.db.$client.query(`
        CREATE INDEX IF NOT EXISTS idx_inbound_gateway_status
            ON "${schemaName}".inbound_gateway (status);
    `);

        await this.db.$client.query(`
        CREATE INDEX IF NOT EXISTS idx_inbound_gateway_object_type
            ON "${schemaName}".inbound_gateway (object_type)
            WHERE object_type IS NOT NULL;
    `);

        await this.db.$client.query(`
        CREATE INDEX IF NOT EXISTS idx_inbound_gateway_created_at
            ON "${schemaName}".inbound_gateway (created_at DESC);
    `);
    }
}
