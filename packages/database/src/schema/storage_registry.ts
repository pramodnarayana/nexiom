import { pgTable, uuid, varchar, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { appConnections } from './tenant.js';

/**
 * THE INFRASTRUCTURE REGISTRY
 *
 * Maps a connectionId to its physical database location and schema.
 * This table lives in the public schema and acts as the global router
 * for the platform's physical infrastructure.
 *
 * Every pipeline worker calls StorageResolverService which reads this
 * table on every message — keep it indexed and lean.
 */
export const connectionStorageRegistry = pgTable(
    'connection_storage_registry',
    {
        // Primary key — also the FK to the business connection
        connectionId: uuid('connection_id')
            .notNull()
            .references(() => appConnections.id, { onDelete: 'cascade' })
            .primaryKey(),

        // The physical Postgres schema name provisioned for this connection
        // e.g. 'ws_salesforce_a1b2c3d4e5f6' — used by workers for SET search_path
        dataNamespace: varchar('data_namespace', { length: 128 }).notNull(),

        // Which DBManager SchemaPlan was last applied
        // e.g. 'NAMESPACE_ONLY' | 'GATEWAY_ACTIVE' | 'REPLICA_ACTIVE' etc.
        // Lets the DBManager skip re-applying plans that are already in place.
        schemaPlan: varchar('schema_plan', { length: 64 }).notNull().default('NAMESPACE_ONLY'),

        // The Physical RDS/Cluster ID — tells the DBManager and connection pool
        // which instance to target. Env-scoped: 'aurora-prod' | 'rds-standard'
        databaseHostId: varchar('database_host_id', { length: 255 })
            .default('aurora-prod')
            .notNull(),

        // Data sovereignty — ensures queries are routed to the right region cluster
        // e.g. 'us-east-1' | 'eu-central-1'
        regionContext: varchar('region_context', { length: 50 }).notNull(),

        createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
        updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull().$onUpdate(() => new Date()),
    },
    (table) => [
        // Each Postgres schema is owned by exactly one connection — prevent accidental
        // reuse of a data_namespace across connections (would cause tenant data leaks).
        uniqueIndex('registry_namespace_unique_idx').on(table.dataNamespace),
        // Storage Resolver looks up by databaseHostId when routing to env-specific pools
        index('registry_host_idx').on(table.databaseHostId),
        // Region routing and compliance queries
        index('registry_region_idx').on(table.regionContext),
    ],
);