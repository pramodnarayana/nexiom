import type { DrizzleDb } from '@soopa/database';

export const DB_MANAGER = 'DB_MANAGER';

export enum SchemaPlan {
    /**
     * Only the empty PostgreSQL schema namespace (e.g., "ws_abc123")
     * Provisioned automatically when a connection handshake succeeds.
     */
    NAMESPACE_ONLY = 'NAMESPACE_ONLY',

    /**
     * The complete set of tables for a connection (both standard pipeline and canonical tables).
     * Provisioned when a connection is activated.
     */
    SCHEMA_ACTIVE = 'SCHEMA_ACTIVE',

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
    applyPlan(tenantId: string, schemaName: string, plan: SchemaPlan): Promise<void>;

    /**
     * Migrates an existing tenant schema to SCHEMA_ACTIVE state.
     */
    migrateToStandardActive?(tenantId: string, schemaName: string): Promise<void>;
}
