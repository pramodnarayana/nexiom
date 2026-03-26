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

        // 3. Ensure Replica Tables exist
        await this.provisionReplicaTables(schemaName);
        if (plan === SchemaPlan.REPLICA_ACTIVE) {
            return;
        }

        // 4. Ensure Normalize Tables exist
        await this.provisionNormalizeTables(schemaName);
        if (plan === SchemaPlan.NORMALIZE_ACTIVE) {
            return;
        }

        // 5. Ensure Outbound Tables exist
        await this.provisionOutboundTables(schemaName);
        // OUTBOUND_ACTIVE — all tables provisioned
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

    private async provisionReplicaTables(schemaName: string): Promise<void> {
        await this.db.$client.query(`
        CREATE TABLE IF NOT EXISTS "${schemaName}".replica_entity (
            id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
            trace_id         UUID        NOT NULL,
            src_req_trace_id UUID        NOT NULL,
            source_id        VARCHAR(255) NOT NULL,
            entity_type      VARCHAR(100) NOT NULL,
            data             JSONB       NOT NULL,
            version          INTEGER     NOT NULL DEFAULT 1,
            updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            CONSTRAINT uq_l2_entity UNIQUE (entity_type, source_id)
        );
    `);

        await this.db.$client.query(`
        CREATE INDEX IF NOT EXISTS idx_l2_trace
            ON "${schemaName}".replica_entity (trace_id);
    `);

        await this.db.$client.query(`
        CREATE INDEX IF NOT EXISTS idx_l2_src_req
            ON "${schemaName}".replica_entity (src_req_trace_id);
    `);

        await this.db.$client.query(`
        CREATE INDEX IF NOT EXISTS idx_l2_data_gin
            ON "${schemaName}".replica_entity USING gin (data);
    `);

        await this.db.$client.query(`
        CREATE TABLE IF NOT EXISTS "${schemaName}".sync_cursor (
            id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
            connection_id         UUID        NOT NULL,
            entity_type           VARCHAR(100) NOT NULL,
            last_sync_timestamp   VARCHAR(255) NOT NULL,
            updated_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
            CONSTRAINT uq_cursor UNIQUE (connection_id, entity_type)
        );
    `);
    }

    private async provisionNormalizeTables(schemaName: string): Promise<void> {
        await this.db.$client.query(`
        CREATE TABLE IF NOT EXISTS "${schemaName}".normalized_entity (
            id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
            trace_id       UUID        NOT NULL,
            replica_id     UUID        NOT NULL,
            canonical_type VARCHAR(100) NOT NULL,
            data           JSONB       NOT NULL,
            created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
    `);

        await this.db.$client.query(`
        CREATE INDEX IF NOT EXISTS idx_l3_trace
            ON "${schemaName}".normalized_entity (trace_id);
    `);

        await this.db.$client.query(`
        CREATE INDEX IF NOT EXISTS idx_l3_replica
            ON "${schemaName}".normalized_entity (replica_id);
    `);

        await this.db.$client.query(`
        CREATE INDEX IF NOT EXISTS idx_l3_canonical
            ON "${schemaName}".normalized_entity (canonical_type);
    `);

        await this.db.$client.query(`
        CREATE INDEX IF NOT EXISTS idx_l3_data_gin
            ON "${schemaName}".normalized_entity USING gin (data);
    `);
    }

    private async provisionOutboundTables(schemaName: string): Promise<void> {
        await this.db.$client.query(`
        CREATE TABLE IF NOT EXISTS "${schemaName}".outbound_gateway (
            id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
            trace_id      UUID        NOT NULL,
            route_id      UUID        NOT NULL,
            req_payload   JSONB       NOT NULL,
            res_payload   JSONB,
            status_code   INTEGER,
            status        TEXT        NOT NULL DEFAULT 'PENDING'
                          CHECK (status IN ('PENDING','SUCCESS','FAIL','RETRY','PROCESSING')),
            attempt_count INTEGER     NOT NULL DEFAULT 0,
            created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
    `);

        await this.db.$client.query(`
        CREATE INDEX IF NOT EXISTS idx_l5_trace
            ON "${schemaName}".outbound_gateway (trace_id);
    `);

        await this.db.$client.query(`
        CREATE INDEX IF NOT EXISTS idx_l5_route
            ON "${schemaName}".outbound_gateway (route_id);
    `);

        await this.db.$client.query(`
        CREATE INDEX IF NOT EXISTS idx_l5_status
            ON "${schemaName}".outbound_gateway (status);
    `);

        await this.db.$client.query(`
        CREATE TABLE IF NOT EXISTS "${schemaName}".sync_log (
            id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
            trace_id    UUID        NOT NULL,
            route_id    UUID,
            layer       TEXT        NOT NULL CHECK (layer IN ('L1','L2','L3','L4','L5','L6')),
            status      TEXT        NOT NULL CHECK (status IN ('RECEIVED','PROCESSING','REPLICATED','NORMALIZED','SKIPPED','PENDING','SUCCESS','FAIL','RETRY')),
            duration_ms INTEGER,
            timestamp   TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
    `);

        await this.db.$client.query(`
        CREATE INDEX IF NOT EXISTS idx_log_trace
            ON "${schemaName}".sync_log (trace_id);
    `);

        await this.db.$client.query(`
        CREATE INDEX IF NOT EXISTS idx_log_route
            ON "${schemaName}".sync_log (route_id);
    `);

        await this.db.$client.query(`
        CREATE INDEX IF NOT EXISTS idx_log_trace_layer
            ON "${schemaName}".sync_log (trace_id, layer);
    `);
    }
}
