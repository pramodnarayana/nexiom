import { pgTable, uuid, varchar, jsonb, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

/**
 * Customer-specific canonical JSON property mappings.
 *
 * Maps raw piece (foreign app) shapes into Nexiom's strictly-typed internal
 * canonical format. Each customer owns and manages their own mappings via the UI.
 *
 * Lives in the tenant DB — one set of mappings per customer, fully isolated.
 */
export const canonicalMappings = pgTable('canonical_mappings', {
    id: uuid('id').defaultRandom().primaryKey(),

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
    // Unique per (app, category, entity, viewMode, version) within this tenant DB
    uniqueIndex('canonical_mapping_unique_idx')
        .on(table.appName, table.category, table.entity, table.viewMode, table.version),
]);
