import {
    pgTable,
    uuid,
    varchar,
    text,
    timestamp,
    primaryKey,
    index,
    uniqueIndex,
    unique,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';
import { envTypeEnum } from './routing.js';
import { dataSources } from './data-sources.js';
export { envTypeEnum } from './routing.js';
// NOTE: No cross-DB FK to organization — tenant isolation enforced by TenantDatabaseManager routing.

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
    // orgId identifies the owning organization. No cross-DB FK to organization table.
    orgId: text('org_id').notNull(),
    name: varchar('name', { length: 255 }).notNull(),
    envType: envTypeEnum('env_type').notNull().default('PRODUCTION'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull().$onUpdate(() => new Date()),
}, (table) => [
    // Case-insensitive uniqueness per env — same name allowed in PRODUCTION vs SANDBOX
    uniqueIndex('ui_ws_org_name_lower_unique_idx').on(table.orgId, table.envType, sql`lower(${table.name})`),
    // Composite unique on (id, orgId) — required target for the composite FK
    // in integration_stitch that enforces workspace ↔ org co-ownership.
    unique('ui_ws_id_org_unique_idx').on(table.id, table.orgId),
    index('ui_ws_org_idx').on(table.orgId),
    index('ui_ws_env_idx').on(table.orgId, table.envType),
]);

/**
 * WORKSPACE DATA SOURCES BRIDGE
 *
 * Selectively assigns global data sources into specific workspaces.
 * A single global data source can appear in multiple workspaces
 * simultaneously. Deletion of either side cascades cleanly.
 */
export const uiWorkspaceDataSources = pgTable('ui_workspace_data_source', {
    workspaceId: uuid('workspace_id')
        .notNull()
        .references(() => uiWorkspaces.id, { onDelete: 'cascade' }),
    dataSourceId: uuid('data_source_id')
        .notNull()
        .references(() => dataSources.id, { onDelete: 'cascade' }),
    assignedAt: timestamp('assigned_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
    primaryKey({ columns: [table.workspaceId, table.dataSourceId] }),
    index('workspace_data_source_ds_idx').on(table.dataSourceId),
]);

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

// Reverse relation from dataSources → uiWorkspaceDataSources.
// Defined here (not in data-sources.ts) to avoid a circular import.
export const dataSourceRelations = relations(dataSources, ({ many }) => ({
    workspaceDataSources: many(uiWorkspaceDataSources),
}));

export const uiWorkspaceRelations = relations(uiWorkspaces, ({ many }) => ({
    dataSources: many(uiWorkspaceDataSources),
}));

export const uiWorkspaceDataSourceRelations = relations(uiWorkspaceDataSources, ({ one }) => ({
    workspace: one(uiWorkspaces, {
        fields: [uiWorkspaceDataSources.workspaceId],
        references: [uiWorkspaces.id],
    }),
    dataSource: one(dataSources, {
        fields: [uiWorkspaceDataSources.dataSourceId],
        references: [dataSources.id],
    }),
}));
