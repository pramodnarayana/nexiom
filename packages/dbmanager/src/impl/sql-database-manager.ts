import type { DatabaseManager } from '../interfaces.js';
import { SchemaPlan } from '../interfaces.js';
import type { DrizzleDb } from '@soopa/database';
import { createHash } from 'node:crypto';
import { getWorkspaceSchemaName } from '../schema-utils.js';

const SAFE_SCHEMA_NAME_RE = /^ws_[a-z0-9_]+$/;

interface Logger {
    debug(msg: string, ...args: unknown[]): void;
    info?(msg: string, ...args: unknown[]): void;
    error?(msg: string, ...args: unknown[]): void;
}

export class SqlDatabaseManager {
    private readonly logger: Logger;

    constructor(
        private readonly db: DrizzleDb,
        logger?: Logger,
        private readonly domainProvisionerResolver?: (appName: string, appProfile: string) => ((db: DrizzleDb, schemaName: string) => Promise<void>) | undefined,
    ) {
        this.logger = logger ?? {
            debug: (msg: string, ...args: unknown[]) => {
                if (process.env.NODE_ENV !== 'production') {
                    console.debug(`[SqlDatabaseManager] ${msg}`, ...args);
                }
            }
        };
    }

    private validateSchemaName(name: string): void {
        if (!SAFE_SCHEMA_NAME_RE.test(name)) {
            throw new Error(
                `Invalid schemaName (sha256 prefix: ${createHash('sha256').update(name).digest('hex').slice(0, 8)}…) — ` +
                `expected format: ws_{workspaceId} with only lowercase letters, digits, and underscores after the prefix.`,
            );
        }
    }

    async applyPlan(schemaName: string, plan: SchemaPlan, context?: { appName: string, appProfile: string }): Promise<void> {
        this.validateSchemaName(schemaName);

        type ProvisioningTask = 'namespace' | 'gateway' | 'replica' | 'normalize' | 'canonical' | 'outbound';

        const PLAN_TASKS: Record<SchemaPlan, ProvisioningTask[]> = {
            [SchemaPlan.NAMESPACE_ONLY]: ['namespace'],
            [SchemaPlan.STANDARD_PROVISIONING]: ['namespace'],
            [SchemaPlan.STANDARD_ACTIVE]: ['namespace', 'gateway', 'replica', 'normalize', 'outbound'],
            [SchemaPlan.CANONICAL_ACTIVE]: ['namespace', 'canonical'],
        };

        const tasks = PLAN_TASKS[plan];
        if (!tasks) {
            throw new Error(`Unknown SchemaPlan: ${plan}`);
        }

        for (const task of tasks) {
            switch (task) {
                case 'namespace':
                    await this.db.$client.query(`CREATE SCHEMA IF NOT EXISTS "${schemaName}";`);
                    break;
                case 'gateway':
                    await this.provisionGatewayTables(schemaName);
                    break;
                case 'replica':
                    await this.provisionReplicaTables(schemaName);
                    break;
                case 'normalize':
                    await this.provisionNormalizeTables(schemaName);
                    break;
                case 'canonical':
                    await this.provisionCanonicalTables(schemaName, context);
                    break;
                case 'outbound':
                    await this.provisionOutboundTables(schemaName);
                    break;
            }
        }
    }

    /**
     * Re-runs provisionReplicaTables on an existing schema.
     * All DDL inside is idempotent (CREATE IF NOT EXISTS + DO $$ BEGIN guards)
     * so this is safe to call on a live tenant schema to apply column renames,
     * additions, or dropped columns without losing data.
     */
    async migrateReplicaTables(schemaName: string): Promise<void> {
        this.validateSchemaName(schemaName);
        await this.provisionReplicaTables(schemaName);
    }

    /**
     * Migrates an existing tenant schema to STANDARD_ACTIVE state.
     * Reapplies all generic provisioner layers (Gateway, Replica, Normalize, Outbound)
     * to ensure existing tenants receive newly provisioned objects:
     * - active_sync_locks table (from provisionGatewayTables)
     * - schema_name columns on outbox tables (from provision*Tables)
     * - sync_log partial indexes (from provisionOutboundTables)
     * All DDL is idempotent so this is safe to run on live schemas.
     */
    async migrateToStandardActive(schemaName: string): Promise<void> {
        this.validateSchemaName(schemaName);
        await this.provisionGatewayTables(schemaName);
        await this.provisionReplicaTables(schemaName);
        await this.provisionNormalizeTables(schemaName);
        await this.provisionOutboundTables(schemaName);
    }


    private async provisionGatewayTables(schemaName: string): Promise<void> {

        // ── LAYER 1 — INBOUND GATEWAY ────────────────────────────────────────
        // Must match pipeline.ts buildTenantSchema > inboundGateway exactly.
        // Uses TEXT + CHECK instead of public.pipeline_status_enum so that
        // tenant schemas have no cross-schema type dependency.
        await this.db.$client.query(`
            CREATE TABLE IF NOT EXISTS "${schemaName}".inbound_gateway (
                id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
                trace_id       UUID         NOT NULL UNIQUE,
                data_source_id UUID         NOT NULL,
                object_type    VARCHAR(100),
                request        JSONB        NOT NULL,
                response      JSONB,
                headers       JSONB,
                ext_req_id    VARCHAR(255),
                status        TEXT         NOT NULL DEFAULT 'RECEIVED',
                error_message TEXT
                              CHECK (status IN ('RECEIVED','PROCESSING','REPLICATED',
                                                'NORMALIZED','SKIPPED','PENDING',
                                                'SUCCESS','FAIL','RETRY','DISMISSED')),
                created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
            );
        `);

        // Idempotency: unique (connection_id, ext_req_id) prevents duplicate
        // vendor events from being ingested twice.
        await this.db.$client.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS idx_l1_ext_id
                ON "${schemaName}".inbound_gateway (data_source_id, ext_req_id)
                WHERE ext_req_id IS NOT NULL;
        `);

        await this.db.$client.query(`
            CREATE INDEX IF NOT EXISTS idx_l1_object_type
                ON "${schemaName}".inbound_gateway (object_type)
                WHERE object_type IS NOT NULL;
        `);

        await this.db.$client.query(`
            CREATE INDEX IF NOT EXISTS idx_l1_status
                ON "${schemaName}".inbound_gateway (status);
        `);

        // Drop old payload GIN index if present, create new request GIN index.
        await this.db.$client.query(`
            DROP INDEX IF EXISTS "${schemaName}".idx_l1_payload_gin;
        `);

        await this.db.$client.query(`
            CREATE INDEX IF NOT EXISTS idx_l1_request_gin
                ON "${schemaName}".inbound_gateway USING gin (request);
        `);

        // ── INBOUND OUTBOX — L1 → L2 transactional outbox ───────────────────
        // Must match pipeline.ts buildTenantSchema > inboundOutbox exactly.
        // Written atomically with inbound_gateway in the same transaction so
        // a process crash between DB commit and SQS publish cannot lose events.
        await this.db.$client.query(`
            CREATE TABLE IF NOT EXISTS "${schemaName}".inbound_outbox (
                id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
                trace_id       UUID         NOT NULL,
                data_source_id UUID         NOT NULL,
                schema_name    VARCHAR(128) NOT NULL DEFAULT current_schema(),
                status        TEXT         NOT NULL DEFAULT 'PENDING'
                              CHECK (status IN ('PENDING','PROCESSING','SUCCESS','FAIL','RETRY')),
                attempts      INTEGER      NOT NULL DEFAULT 0,
                error_message    VARCHAR(500),
                claim_token   VARCHAR(36),
                next_retry_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
                created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
                CONSTRAINT idx_inbound_outbox_trace UNIQUE (trace_id, data_source_id)
            );
        `);

        await this.db.$client.query(`
            CREATE INDEX IF NOT EXISTS idx_inbound_outbox_claim
                ON "${schemaName}".inbound_outbox (status, next_retry_at ASC)
                WHERE status IN ('PENDING', 'PROCESSING', 'RETRY');
        `);


        // ── ACTIVE SYNC LOCKS — L1 → L6 concurrency control ─────────────────
        await this.db.$client.query(`
            CREATE TABLE IF NOT EXISTS "${schemaName}".active_sync_locks (
                id                 UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
                data_source_id     UUID         NOT NULL,
                entity_id          VARCHAR(255) NOT NULL,
                locked_by_trace_id UUID         NOT NULL,
                expires_at         TIMESTAMPTZ  NOT NULL,
                created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
                CONSTRAINT uq_sync_lock UNIQUE (data_source_id, entity_id)
            );
        `);

        await this.db.$client.query(`
        CREATE TABLE IF NOT EXISTS "${schemaName}".sync_log (
            id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
            trace_id    UUID        NOT NULL,
            route_id    UUID,
            layer       TEXT        NOT NULL CHECK (layer IN ('L1','L2','L3','L4','L5','L6')),
            status      TEXT        NOT NULL CHECK (status IN ('RECEIVED','PROCESSING','REPLICATED','NORMALIZED','SKIPPED','PENDING','SUCCESS','FAIL','RETRY','DISMISSED')),
            duration_ms INTEGER,
            error_message TEXT,
            timestamp   TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
    `);


        // Create the modern routed/unrouted partial unique indexes
        await this.db.$client.query(`

        CREATE UNIQUE INDEX IF NOT EXISTS uq_sync_log_routed
            ON "${schemaName}".sync_log (trace_id, route_id, layer, status)
            WHERE route_id IS NOT NULL;
    `);

        await this.db.$client.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS uq_sync_log_unrouted
            ON "${schemaName}".sync_log (trace_id, layer, status)
            WHERE route_id IS NULL;
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

    private async provisionReplicaTables(schemaName: string): Promise<void> {

        await this.db.$client.query(`
        CREATE TABLE IF NOT EXISTS "${schemaName}".replica_entity (
            id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
            data_source_id UUID         NOT NULL,
            trace_id       UUID         NOT NULL,
            entity_id      VARCHAR(255) NOT NULL,
            entity_type    VARCHAR(100) NOT NULL,
            data           JSONB        NOT NULL,
            version        INTEGER      NOT NULL DEFAULT 1,
            created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
            updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
            CONSTRAINT uq_l2_entity UNIQUE (data_source_id, entity_type, entity_id)
        );
    `);

        await this.db.$client.query(`
        CREATE INDEX IF NOT EXISTS idx_l2_trace
            ON "${schemaName}".replica_entity (trace_id);
    `);

        await this.db.$client.query(`
        CREATE INDEX IF NOT EXISTS idx_l2_data_gin
            ON "${schemaName}".replica_entity USING gin (data);
    `);

        await this.db.$client.query(`
        CREATE TABLE IF NOT EXISTS "${schemaName}".sync_cursor (
            id                    UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
            data_source_id        UUID         NOT NULL,
            entity_type           VARCHAR(100) NOT NULL,
            last_sync_timestamp   VARCHAR(255) NOT NULL,
            updated_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
            CONSTRAINT uq_cursor UNIQUE (data_source_id, entity_type)
        );
    `);

        // ── REPLICA OUTBOX — L2 → L3 transactional outbox ───────────────────
        await this.db.$client.query(`
        CREATE TABLE IF NOT EXISTS "${schemaName}".replica_outbox (
            id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
            trace_id      UUID         NOT NULL,
            data_source_id UUID        NOT NULL,
            schema_name   VARCHAR(128) NOT NULL DEFAULT current_schema(),
            status        TEXT         NOT NULL DEFAULT 'PENDING'
                          CHECK (status IN ('PENDING','PROCESSING','SUCCESS','FAIL','RETRY')),
            attempts      INTEGER      NOT NULL DEFAULT 0,
            error_message    VARCHAR(500),
            next_retry_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
            claim_token   VARCHAR(36),
            created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
            CONSTRAINT idx_replica_outbox_trace UNIQUE (trace_id, data_source_id)
        );
    `);


        await this.db.$client.query(`
            CREATE INDEX IF NOT EXISTS idx_replica_outbox_claim
            ON "${schemaName}".replica_outbox (status, next_retry_at ASC)
            WHERE status IN ('PENDING', 'PROCESSING', 'RETRY');
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
            created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            published_at   TIMESTAMPTZ,
            CONSTRAINT uq_l3_replica UNIQUE (replica_id)
        );
    `);


        await this.db.$client.query(`
        CREATE INDEX IF NOT EXISTS idx_l3_trace
            ON "${schemaName}".normalized_entity (trace_id);
    `);



        await this.db.$client.query(`
        CREATE INDEX IF NOT EXISTS idx_l3_canonical
            ON "${schemaName}".normalized_entity (canonical_type);
    `);

        await this.db.$client.query(`
        CREATE INDEX IF NOT EXISTS idx_l3_data_gin
            ON "${schemaName}".normalized_entity USING gin (data);
    `);

        await this.db.$client.query(`
        CREATE TABLE IF NOT EXISTS "${schemaName}".normalized_outbox (
            id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
            trace_id       UUID        NOT NULL,
            data_source_id UUID        NOT NULL,
            schema_name    VARCHAR(128) NOT NULL DEFAULT current_schema(),
            status        TEXT        NOT NULL DEFAULT 'PENDING'
                          CHECK (status IN ('PENDING','PROCESSING','SUCCESS','FAIL','RETRY')),
            attempts      INTEGER     NOT NULL DEFAULT 0,
            error_message    VARCHAR(500),
            claim_token   VARCHAR(36),
            next_retry_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            CONSTRAINT idx_normalized_outbox_trace UNIQUE (trace_id, data_source_id)
        );
    `);



        await this.db.$client.query(`
            CREATE INDEX IF NOT EXISTS idx_normalized_outbox_claim
            ON "${schemaName}".normalized_outbox (status, next_retry_at ASC)
            WHERE status IN ('PENDING', 'PROCESSING', 'RETRY');
    `);

    }

    private async provisionCanonicalTables(schemaName: string, context?: { appName: string, appProfile: string }): Promise<void> {
        try {
            let appName: string | undefined = context?.appName;
            let appProfile: string | undefined = context?.appProfile;

            // Fallback removed: explicitly require context for canonical provisioning
            if (!appName || !appProfile) {
                throw new Error('context.appName and context.appProfile are required for canonical table provisioning.');
            }

            if (appName && appProfile && this.domainProvisionerResolver) {
                const provisioner = this.domainProvisionerResolver(appName, appProfile);
                if (provisioner) {
                    this.logger.debug(`Applying domain provisioner for appName=${appName}/${appProfile} in schema=${schemaName}`);
                    await provisioner(this.db, schemaName);
                    return;
                } else {
                    this.logger.debug(`No domain provisioner found for appName=${appName}/${appProfile} in schema=${schemaName}`);
                }
            } else if (!this.domainProvisionerResolver) {
                this.logger.debug(`No domainProvisionerResolver provided to SqlDatabaseManager`);
            }
        } catch (error) {
            this.logger.error?.(`Failed to invoke domain provisioner for schema ${schemaName}: ${error instanceof Error ? error.message : String(error)}`);
            // Re-throw the error so the caller can stop the state transition
            throw error;
        }
    }

    private async provisionOutboundTables(schemaName: string): Promise<void> {
        await this.db.$client.query(`
        CREATE TABLE IF NOT EXISTS "${schemaName}".outbound_gateway (
            id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
            trace_id       UUID        NOT NULL,
            route_id       UUID        NOT NULL,
            data_source_id UUID        NOT NULL,
            src_data_source_id UUID,
            payload        JSONB       NOT NULL,
            response       JSONB,
            status_code   INTEGER,
            dest_vendor_id VARCHAR(255),
            status        TEXT        NOT NULL DEFAULT 'PENDING'
                          CONSTRAINT ck_outbound_status CHECK (status IN ('PENDING','SUCCESS','FAIL','RETRY','PROCESSING','DISMISSED','DEFERRED_DEPENDENCY')),
            attempts      INTEGER     NOT NULL DEFAULT 0,
            error_message    TEXT,
            claim_token   VARCHAR(36),
            next_retry_at TIMESTAMPTZ,
            created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            CONSTRAINT uq_outbound_trace_route UNIQUE (trace_id, route_id)
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


        /**
         * DELIVERY OUTBOX — Transactional outbox for reliable queue hand-off.
         *
         * Written by the Fan-Out engine (L4) inside the same DB transaction as
         * outbound_gateway. The OutboxWorker (L5) polls this table and publishes
         * to Delivery_Queue, marking the row delivered_at on success.
         * This guarantees at-least-once delivery even if the process crashes
         * between the DB commit and the queue publish.

         */
        await this.db.$client.query(`
        CREATE TABLE IF NOT EXISTS "${schemaName}".outbound_outbox (
            id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
            trace_id      UUID        NOT NULL,
            route_id      UUID        NOT NULL,
            outbound_gateway_id UUID  NOT NULL,
            payload       JSONB       NOT NULL,
            schema_name   VARCHAR(128) NOT NULL DEFAULT current_schema(),
            status        TEXT        NOT NULL DEFAULT 'PENDING'
                          CHECK (status IN ('PENDING','PROCESSING','SUCCESS','FAIL','RETRY')),
            attempts      INTEGER     NOT NULL DEFAULT 0,
            error_message    VARCHAR(500),
            next_retry_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            CONSTRAINT uq_outbound_outbox UNIQUE (trace_id, route_id, outbound_gateway_id)
        );
    `);




        await this.db.$client.query(`
            CREATE INDEX IF NOT EXISTS idx_outbound_outbox_claim
            ON "${schemaName}".outbound_outbox (status, next_retry_at ASC)
            WHERE status IN ('PENDING', 'PROCESSING', 'RETRY');
    `);
    }
}