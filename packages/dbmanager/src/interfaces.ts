import type { DrizzleDb } from '@soopa/database';

export const DB_MANAGER = 'DB_MANAGER';

export enum SchemaPlan {
    /**
     * Only the empty PostgreSQL schema namespace (e.g., "ws_abc123")
     * Provisioned automatically when a connection handshake succeeds.
     */
    NAMESPACE_ONLY = 'NAMESPACE_ONLY',

    /**
     * The L1 Gateway tables (inbound_gateway, sync_log).
     * Provisioned when a Route/Webhook is activated.
     * Note: sync_log is provisioned here so L1/L2 can log successes/failures.
     */
    GATEWAY_ACTIVE = 'GATEWAY_ACTIVE',

    /**
     * The L2 Unified Replica tables (replica_entity, sync_cursor)
     * Provisioned when an object mapping is initialized.
     */
    REPLICA_ACTIVE = 'REPLICA_ACTIVE',

    /**
     * The L3 Normalization tables (normalized_entity)
     * Provisioned when normalization is activated for a connection.
     */
    NORMALIZE_ACTIVE = 'NORMALIZE_ACTIVE',

    /**
     * Per-entity typed canonical tables (canonical_account, canonical_tp).
     * Provisioned when typed canonical tables are required by the application.
     * These replace the generic normalized_entity JSONB blob with typed
     * columns and native FK relationships for SQL JOIN enrichment.
     */
    CANONICAL_ACTIVE = 'CANONICAL_ACTIVE',

    /**
     * The L5/L6 Outbound tables (outbound_gateway, sync_log)
     * Provisioned when delivery is activated for a connection.
     */
    OUTBOUND_ACTIVE = 'OUTBOUND_ACTIVE',
}

/**
 * Enterprise declarative database manager interface.
 * Implements the Hexagonal Architecture "Port" pattern to decouple
 * physical schema provisioning from API business logic.
 */
export interface DatabaseManager {
    /**
     * Resolves a physical DrizzleDb connection for a specific tenant ID.
     */
    getTenantDb(tenantId: string): Promise<DrizzleDb>;

    /**
     * Idempotently bring the schema up to the desired plan level.
     * If the schema already exceeds the plan, it does nothing.
     */
    applyPlan(tenantId: string, schemaName: string, plan: SchemaPlan, context?: { appName: string, appProfile: string }): Promise<void>;

    /**
     * Migrates an existing tenant schema to OUTBOUND_ACTIVE state.
     */
    migrateToOutboundActive?(tenantId: string, schemaName: string, context?: { appName: string, appProfile: string }): Promise<void>;
}
