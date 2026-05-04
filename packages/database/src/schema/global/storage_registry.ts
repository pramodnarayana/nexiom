import { pgTable, text, varchar, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';

/**
 * THE INFRASTRUCTURE REGISTRY (Global Control Plane)
 *
 * Maps a tenant (organization_id) to its physical database location.
 * This table lives in the global db_nexiom_global database and acts as the
 * global router for the platform's physical infrastructure.
 *
 * Every pipeline worker calls TenantDatabaseManager which reads this
 * table to resolve the correct database connection pool.
 */
export const tenantStorageRegistry = pgTable(
    'tenant_storage_registry',
    {
        // Primary key — The tenant/organization ID.
        // No inline references() since organization table is in identity.ts
        // and we want to keep schemas decoupled.
        tenantId: text('tenant_id').notNull().primaryKey(),

        // The physical Postgres database name provisioned for this tenant
        // e.g. 'db_edlewis_corp'
        databaseName: varchar('database_name', { length: 128 }).notNull(),

        // The Physical RDS/Cluster connection URL or Host ID — tells the DBManager
        // which instance to target.
        databaseHostUrl: varchar('database_host_url', { length: 255 }).notNull(),

        // Data sovereignty — ensures queries are routed to the right region cluster
        // e.g. 'us-east-1' | 'eu-central-1'
        regionContext: varchar('region_context', { length: 50 }).notNull(),

        // The lifecycle state of the database (WARM, ACTIVE, SUSPENDED, DELETED)
        status: varchar('status', { length: 20 }).default('ACTIVE').notNull(),

        createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
        updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull().$onUpdate(() => new Date()),
    },
    (table) => [
        // Each database is owned by exactly one tenant
        uniqueIndex('registry_dbname_unique_idx').on(table.databaseName),
        // Region routing and compliance queries
        index('registry_region_idx').on(table.regionContext),
    ],
);