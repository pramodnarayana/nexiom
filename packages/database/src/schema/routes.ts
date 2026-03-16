import {
    pgTable,
    pgEnum,
    uuid,
    varchar,
    text,
    integer,
    boolean,
    jsonb,
    timestamp,
    index,
    uniqueIndex,
    foreignKey,
    check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { appConnections } from './tenant.js';
import { uiWorkspaces } from './workspace.js';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const routeStatusEnum = pgEnum('route_status_enum', ['ACTIVE', 'PAUSED', 'ARCHIVED']);

/**
 * Allowed sync intervals in minutes.
 * Stored as an integer so the scheduler can use it directly:
 *   BullMQ: `repeat: { every: syncIntervalMinutes * 60_000 }`
 * Support team can override per-route via the admin API.
 */
export const SYNC_INTERVAL_OPTIONS = [30, 60, 120, 240, 360, 720, 1440] as const;
export type SyncIntervalMinutes = typeof SYNC_INTERVAL_OPTIONS[number];

// ---------------------------------------------------------------------------

/**
 * INTEGRATION ROUTES
 *
 * Defines the logical sync path between a source and destination connection.
 * Lives at the workspace level — one workspace can have many routes.
 *
 * `syncCondition` is a JSONB array of rule objects evaluated at L4:
 *   [{ "field": "Region", "op": "eq", "value": "US", "logic": "AND" }]
 *
 * `sourceObject` / `targetObject` are vendor object names resolved via
 * the Metadata Discovery Service (e.g. 'rtms__Load__c', 'Invoice').
 */
export const integrationRoutes = pgTable('integration_route', {
    id: uuid('id').defaultRandom().primaryKey(),
    // Human-readable name shown in UI — e.g. "Salesforce Loads → QuickBooks Invoices"
    name: varchar('name', { length: 255 }).notNull(),
    // text — matches organization.id (and uiWorkspaces.orgId after workspace.ts fix).
    // No independent FK to organization — org ownership is guaranteed by the
    // composite FK (workspaceId, orgId) → (uiWorkspaces.id, uiWorkspaces.orgId)
    // in the table constraints below, which makes it impossible to pair a
    // workspace with an org that doesn't own it.
    orgId: text('org_id').notNull(),
    workspaceId: uuid('workspace_id').notNull(),
    srcConnectionId: uuid('src_connection_id')
        .notNull()
        .references(() => appConnections.id),
    destConnectionId: uuid('dest_connection_id')
        .notNull()
        .references(() => appConnections.id),
    // Vendor object names resolved at route-creation time via describe API
    sourceObject: varchar('source_object', { length: 255 }).notNull(),
    targetObject: varchar('target_object', { length: 255 }).notNull(),
    // Array of filter rules evaluated at L4 (Fan-Out Decision)
    syncCondition: jsonb('sync_condition').notNull().default([]),
    status: routeStatusEnum('status').notNull().default('ACTIVE'),
    // Scheduler — how often the poller fires for this route.
    // Default: 30 minutes. Support team configurable via admin API.
    // DB enforces > 0 via CHECK constraint; application code should also
    // validate before writing (throw when syncIntervalMinutes <= 0).
    syncIntervalMinutes: integer('sync_interval_minutes').notNull().default(30),
    scheduleEnabled: boolean('schedule_enabled').notNull().default(true),
    // Timestamp of the last scheduled execution (set by SchedulerService)
    lastScheduledAt: timestamp('last_scheduled_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull().$onUpdate(() => new Date()),
}, (table) => [
    // Composite FK: (workspaceId, orgId) → (uiWorkspaces.id, uiWorkspaces.orgId)
    // Guarantees the workspace actually belongs to the org on this route —
    // makes mismatched (workspaceId=ws-B, orgId=org-A) impossible at DB level.
    foreignKey({
        columns: [table.workspaceId, table.orgId],
        foreignColumns: [uiWorkspaces.id, uiWorkspaces.orgId],
        name: 'route_workspace_org_fk',
    }).onDelete('cascade'),
    // Cascade deletes when either the source or destination connection is removed
    foreignKey({
        columns: [table.srcConnectionId],
        foreignColumns: [appConnections.id],
        name: 'route_src_connection_fk',
    }),
    foreignKey({
        columns: [table.destConnectionId],
        foreignColumns: [appConnections.id],
        name: 'route_dest_connection_fk',
    }),
    // Reject zero/negative intervals at the DB layer
    check('sync_interval_minutes_positive', sql`${table.syncIntervalMinutes} > 0`),
    index('route_workspace_idx').on(table.workspaceId),
    index('route_org_idx').on(table.orgId),
    index('route_src_conn_idx').on(table.srcConnectionId),
    index('route_dest_conn_idx').on(table.destConnectionId),
    index('route_status_idx').on(table.orgId, table.status),
]);

/**
 * FIELD MAPPINGS
 *
 * The field-level transformation template for a route.
 *
 * `sourceCanonical` is the canonical type this mapping applies to
 * (e.g. 'TMS_INVOICE'), scoping mappings per object type on a route.
 *
 * `mappingRules` is a JSONB array of JSONPath transformation rules:
 *   [{ "src": "$.rtms__Total_Amount__c", "dest": "$.TotalAmt" }]
 */
export const fieldMappings = pgTable('field_mapping', {
    id: uuid('id').defaultRandom().primaryKey(),
    routeId: uuid('route_id')
        .notNull()
        .references(() => integrationRoutes.id, { onDelete: 'cascade' }),
    // The canonical object type this template applies to
    sourceCanonical: varchar('source_canonical', { length: 100 }).notNull(),
    // Array of { src: JSONPath, dest: JSONPath, transform?: expression }
    mappingRules: jsonb('mapping_rules').notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull().$onUpdate(() => new Date()),
}, (table) => [
    // uniqueIndex on (routeId, sourceCanonical) already covers routeId lookups;
    // a separate index on routeId alone would add write/storage overhead for no gain.
    uniqueIndex('field_mapping_route_canonical_unique_idx').on(table.routeId, table.sourceCanonical),
]);
