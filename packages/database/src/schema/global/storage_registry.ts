import { pgTable, text, varchar, timestamp, index, integer } from 'drizzle-orm/pg-core';

/**
 * THE INFRASTRUCTURE REGISTRY (Global Control Plane)
 *
 * Maps a tenant (organization_id) to its physical database location.
 * This table lives in the global platform_global database and acts as the
 * global router for the platform's Hybrid Tenancy infrastructure.
 *
 * Hybrid Tenancy Model:
 *  - Standard tenants share a sharded database (e.g. 'platform_shard_1').
 *    Multiple tenants map to the same databaseName.
 *  - Enterprise tenants get dedicated databases (e.g. 'tenant_<id>').
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
        // Multiple standard tenants may share the same shard database,
        // so this is a regular index (not unique).
        index('registry_dbname_idx').on(table.databaseName),
        // Region routing and compliance queries
        index('registry_region_idx').on(table.regionContext),
    ],
);

/**
 * SHARD REGISTRY
 *
 * Tracks physical database shards available for standard tenants.
 * Used by DBManager to perform load balancing when routing new standard tenants.
 */
export const shardRegistry = pgTable(
    'shard_registry',
    {
        id: varchar('id', { length: 50 }).primaryKey(), // e.g. 'shard_1'
        databaseName: varchar('database_name', { length: 128 }).notNull(), // e.g. 'platform_shard_1'
        databaseHostUrl: varchar('database_host_url', { length: 255 }).notNull(),
        regionContext: varchar('region_context', { length: 50 }).notNull(),
        status: varchar('status', { length: 20 }).default('ACTIVE').notNull(), // ACTIVE, DRAINING, FULL
        maxTenants: integer('max_tenants').notNull().default(1000),
        currentTenants: integer('current_tenants').notNull().default(0),
        createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
        updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull().$onUpdate(() => new Date()),
    },
    (table) => [
        // Composite index for shard selection queries that filter by status and region
        // and order by available capacity (max_tenants - current_tenants)
        index('shard_status_region_idx').on(table.status, table.regionContext, table.currentTenants),
    ],
);