import type { DrizzleDb } from '@soopa/database';

export const DB_MANAGER = 'DB_MANAGER';

export enum SchemaPlan {
    /**
     * Only the empty PostgreSQL schema namespace (e.g., "ws_abc123")
     * Provisioned automatically when a connection handshake succeeds.
     */
    NAMESPACE_ONLY = 'NAMESPACE_ONLY',

    /**
     * Per-entity typed canonical tables (canonical_account, canonical_tp).
     * Provisioned dynamically when an initial sync happens for a specific app.
     * These replace the generic normalized_entity JSONB blob with typed
     * columns and native FK relationships for SQL JOIN enrichment.
     */
    CANONICAL_ACTIVE = 'CANONICAL_ACTIVE',

    /**
     * The L5/L6 Outbound tables (outbound_gateway, sync_log).
     * Now called STANDARD_ACTIVE to represent the complete set of generic pipeline tables.
     * Provisioned when delivery is activated for a connection.
     */
    STANDARD_ACTIVE = 'STANDARD_ACTIVE',
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
     * Migrates an existing tenant schema to STANDARD_ACTIVE state.
     */
    migrateToStandardActive?(tenantId: string, schemaName: string): Promise<void>;
}
