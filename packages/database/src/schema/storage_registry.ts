import { pgTable, uuid, varchar, timestamp, index } from 'drizzle-orm/pg-core';
import { appConnections } from './tenant';

/**
 * THE INFRASTRUCTURE REGISTRY
 * Maps a connectionId to its physical database location and schema.
 * This table lives in the public schema and acts as the global router for the platform's physical infrastructure.
 */
export const connectionStorageRegistry = pgTable(
    'connection_storage_registry',
    {
        // 1. Foreign Key to the business connection
        connectionId: uuid('connection_id')
            .notNull()
            .references(() => appConnections.id, { onDelete: 'cascade' })
            .primaryKey(),

        // 2. The physical Postgres Schema name (e.g., 'ws_sf_101')
        // This is used by sync workers for 'SET search_path TO ...'
        workspaceId: varchar('workspace_id', { length: 128 }).notNull(),

        // 3. The Physical RDS/Cluster ID
        // Tells the DB Manager which instance to target for migrations/queries
        databaseHostId: varchar('database_host_id', { length: 255 })
            .default('primary-cluster')
            .notNull(),

        // 4. Compliance/Region Context
        // Ensures data sovereignty requirements are met
        regionContext: varchar('region_context', { length: 50 })
            .default('us-east-1')
            .notNull(),

        createdAt: timestamp('created_at').defaultNow().notNull(),
        updatedAt: timestamp('updated_at').defaultNow().notNull(),
    },
    (table) => ({
        connIdx: index('idx_storage_conn').on(table.connectionId),
    }),
);
