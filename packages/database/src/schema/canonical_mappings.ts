import { pgTable, uuid, varchar, jsonb, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

/**
 * Storage for canonical JSON property mappings.
 * Maps raw piece (foreign app) shapes into Nexiom's strictly-typed internal objects.
 */
export const canonicalMappings = pgTable('canonical_mappings', {
    id: uuid('id').defaultRandom().primaryKey(),
    
    /** e.g. "salesforce", "quickbooks" -> Matches Piece name */
    appName: varchar('app_name', { length: 100 }).notNull(),
    
    /** e.g. "TMS", "Accounting", "CRM" */
    category: varchar('category', { length: 50 }).notNull(),
    
    /** e.g. "Load", "Invoice" */
    entity: varchar('entity', { length: 100 }).notNull(),
    
    /** e.g. "summary", "financial", "execution" (Supports lazy loading constraints) */
    viewMode: varchar('view_mode', { length: 50 }).notNull(),
    
    /** Optional overriding for a specific tenant -> if null, it is global */
    tenantId: varchar('tenant_id', { length: 100 }),
    
    /** Versioning strategy e.g. "v1" */
    version: varchar('version', { length: 50 }).notNull().default('v1'),
    
    /** The generic JSON document dictating the transformation paths */
    mappingConfig: jsonb('mapping_config').notNull(),
    
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull().$onUpdate(() => new Date()),
}, (table) => {
    return {
        /** Enforce unique constraints so there's only one master mapping per identity/version */
        uniqueMappingIdx: uniqueIndex('canonical_mapping_unique_idx')
            .on(table.appName, table.category, table.entity, table.viewMode, table.version)
            // Use IS NOT DISTINCT FROM or standard WHERE clauses for nullable combinations if needed
            // For now, index globally but practically tenant overrides might need separate handling
            // We'll trust application logic to resolve tenant-first vs global fallback.
    };
});
