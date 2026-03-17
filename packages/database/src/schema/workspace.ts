import {
    pgTable,
    pgEnum,
    uuid,
    varchar,
    text,
    timestamp,
    primaryKey,
    index,
    uniqueIndex,
} from 'drizzle-orm/pg-core';
import { organization } from './identity.js';
import { appConnections } from './tenant.js';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const envTypeEnum = pgEnum('env_type_enum', ['PRODUCTION', 'SANDBOX']);

// ---------------------------------------------------------------------------

/**
 * UI WORKSPACES
 *
 * Logical folders that group connections and integrations for a team.
 * Each workspace is tagged as PRODUCTION or SANDBOX, which controls
 * which physical DB cluster the Storage Registry routes writes to.
 *
 * One org can have many workspaces (e.g. "Logistics-US", "Logistics-CA").
 */
export const uiWorkspaces = pgTable('ui_workspace', {
    id: uuid('id').defaultRandom().primaryKey(),
    // text — matches organization.id which is also text
    orgId: text('org_id')
        .notNull()
        .references(() => organization.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 255 }).notNull(),
    envType: envTypeEnum('env_type').notNull().default('PRODUCTION'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull().$onUpdate(() => new Date()),
}, (table) => [
    uniqueIndex('ui_workspace_org_name_unique_idx').on(table.orgId, table.name),
    // Composite unique on (id, orgId) — required target for the composite FK
    // in integration_route that enforces workspace ↔ org co-ownership.
    uniqueIndex('ui_workspace_id_org_unique_idx').on(table.id, table.orgId),
    index('ui_workspace_org_idx').on(table.orgId),
    index('ui_workspace_env_idx').on(table.orgId, table.envType),
]);

/**
 * WORKSPACE CONNECTIONS BRIDGE
 *
 * Selectively assigns global connections into specific workspaces.
 * A single connection (e.g. "Salesforce Master") can appear in multiple
 * workspaces simultaneously. Deletion of either side cascades cleanly.
 */
export const uiWorkspaceConnections = pgTable('ui_workspace_connection', {
    workspaceId: uuid('workspace_id')
        .notNull()
        .references(() => uiWorkspaces.id, { onDelete: 'cascade' }),
    connectionId: uuid('connection_id')
        .notNull()
        .references(() => appConnections.id, { onDelete: 'cascade' }),
    assignedAt: timestamp('assigned_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
    primaryKey({ columns: [table.workspaceId, table.connectionId] }),
    index('workspace_connection_conn_idx').on(table.connectionId),
]);
