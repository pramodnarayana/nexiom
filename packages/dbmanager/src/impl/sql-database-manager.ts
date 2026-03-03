import type { DatabaseManager } from '../interfaces';
import { SchemaPlan } from '../interfaces';
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

        // Run DDL inside a transaction to prevent partial schema/table creation
        await this.db.transaction(async (tx) => {
            // 1. Always ensure namespace exists (Minimum baseline for all plans)
            await tx.execute(
                `CREATE SCHEMA IF NOT EXISTS "${schemaName}";`,
            );

            if (plan === SchemaPlan.NAMESPACE_ONLY) {
                return;
            }

            // 2. Ensure Gateway Tables exist
            await this.provisionGatewayTables(tx, schemaName);

            if (plan === SchemaPlan.GATEWAY_ACTIVE) {
                return;
            }

            // 3. (Future) Ensure Replica Tables exist
            if (plan === SchemaPlan.REPLICA_ACTIVE) {
                throw new Error('Provisioning for SchemaPlan.REPLICA_ACTIVE is not yet implemented.');
            }
        });
    }

    private async provisionGatewayTables(tx: any, schemaName: string): Promise<void> {
        // We execute these independently so that they are idempotent.
        // If they error, the transaction rolls back, preventing partial corruption.
        await tx.execute(`
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

        await tx.execute(`
        CREATE INDEX IF NOT EXISTS idx_inbound_gateway_status
            ON "${schemaName}".inbound_gateway (status);
    `);

        await tx.execute(`
        CREATE INDEX IF NOT EXISTS idx_inbound_gateway_object_type
            ON "${schemaName}".inbound_gateway (object_type)
            WHERE object_type IS NOT NULL;
    `);

        await tx.execute(`
        CREATE INDEX IF NOT EXISTS idx_inbound_gateway_created_at
            ON "${schemaName}".inbound_gateway (created_at DESC);
    `);
    }
}
