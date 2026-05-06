import { pgTable, uuid, varchar, jsonb, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/**
 * Customer-specific canonical JSON property mappings.
 *
 * Maps raw piece (foreign app) shapes into Nexiom's strictly-typed internal
 * canonical format. Each customer owns and manages their own mappings via the UI.
 *
 * Lives in both the global DB (for system-wide defaults) and tenant DBs (for overrides).
 * tenant_id column is used in the global DB to store tenant-specific or global (NULL) mappings.
 * In tenant DBs, tenant_id is typically NULL as tenancy is implicit in the DB itself.
 */
export const canonicalMappings = pgTable('canonical_mappings', {
    id: uuid('id').defaultRandom().primaryKey(),

    /**
     * Tenant identifier. Used in global DB to differentiate between:
     * - NULL: global system default mappings
     * - <tenant_id>: tenant-specific overrides stored in global DB
     * In tenant DBs, this is typically NULL as tenancy is implicit.
     */
    tenantId: varchar('tenant_id', { length: 100 }),

    /** e.g. "salesforce", "quickbooks" → matches Piece name */
    appName: varchar('app_name', { length: 100 }).notNull(),

    /** e.g. "TMS", "Accounting", "CRM" */
    category: varchar('category', { length: 50 }).notNull(),

    /** e.g. "Load", "Invoice" */
    entity: varchar('entity', { length: 100 }).notNull(),

    /** e.g. "summary", "financial", "execution" (supports lazy loading) */
    viewMode: varchar('view_mode', { length: 50 }).notNull(),

    /** Versioning strategy e.g. "v1" */
    version: varchar('version', { length: 50 }).notNull().default('v1'),

    /** The JSON document dictating transformation paths — managed via UI */
    mappingConfig: jsonb('mapping_config').notNull(),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull().$onUpdate(() => new Date()),
}, (table) => [
    // Partial unique index for tenant-specific mappings (tenant_id IS NOT NULL)
    uniqueIndex('canonical_mapping_tenant_idx')
        .on(table.tenantId, table.appName, table.category, table.entity, table.viewMode, table.version)
        .where(sql`${table.tenantId} IS NOT NULL`),

    // Partial unique index for global mappings (tenant_id IS NULL)
    uniqueIndex('canonical_mapping_global_idx')
        .on(table.appName, table.category, table.entity, table.viewMode, table.version)
        .where(sql`${table.tenantId} IS NULL`),
]);
