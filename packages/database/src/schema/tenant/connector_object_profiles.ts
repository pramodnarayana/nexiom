import { jsonb, pgTable, uuid, varchar, timestamp, primaryKey, index } from 'drizzle-orm/pg-core';
import { dataSources } from '../global/data-sources.js';

/**
 * CONNECTOR OBJECT PROFILES
 *
 * Metadata cache for vendor object/field schemas discovered via the
 * Metadata Discovery Service.
 *
 * Keyed on (dataSourceId, objectName) — NOT (appName, objectName) — because
 * Salesforce-style custom objects (e.g. rtms__Load__c) are org-specific and
 * differ per customer instance. Two customers with the same app may have
 * completely different custom field sets.
 *
 * TTL-invalidated via application code: MetadataDiscoveryService checks
 * (now - updatedAt) against a 5-minute threshold before calling the piece.
 */
export const connectorObjectProfiles = pgTable('connector_object_profiles', {
    dataSourceId: uuid('data_source_id')
        .notNull()
        .references(() => dataSources.id, { onDelete: 'cascade' }),
    objectName: varchar('object_name', { length: 255 }).notNull(),
    // Full field schema as returned by piece.describeFields()
    profile: jsonb('profile').notNull().default('{}'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull().$onUpdate(() => new Date()),
}, (table) => [
    primaryKey({ columns: [table.dataSourceId, table.objectName] }),
]);
