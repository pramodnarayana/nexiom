import { jsonb, pgTable, uuid, varchar, timestamp, primaryKey, index } from 'drizzle-orm/pg-core';
import { appConnections } from '../global/routing.js';

/**
 * CONNECTOR OBJECT PROFILES
 *
 * Metadata cache for vendor object/field schemas discovered via the
 * Metadata Discovery Service.
 *
 * Keyed on (connectionId, objectName) — NOT (appName, objectName) — because
 * Salesforce-style custom objects (e.g. rtms__Load__c) are org-specific and
 * differ per customer instance. Two customers with the same app may have
 * completely different custom field sets.
 *
 * TTL-invalidated via application code: MetadataDiscoveryService checks
 * (now - updatedAt) against a 5-minute threshold before calling the piece.
 */
export const connectorObjectProfiles = pgTable('connector_object_profiles', {
    connectionId: uuid('connection_id')
        .notNull()
        .references(() => appConnections.id, { onDelete: 'cascade' }),
    objectName: varchar('object_name', { length: 255 }).notNull(),
    // Full field schema as returned by piece.describeFields()
    profile: jsonb('profile').notNull().default('{}'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull().$onUpdate(() => new Date()),
}, (table) => [
    primaryKey({ columns: [table.connectionId, table.objectName] }),
    // Allows MetadataDiscoveryService to list all cached objects for a connection
    index('cop_connection_idx').on(table.connectionId),
]);
