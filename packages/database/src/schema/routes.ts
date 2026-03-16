import {
    pgTable,
    pgEnum,
    uuid,
    varchar,
    integer,
    boolean,
    jsonb,
    timestamp,
    index,
    uniqueIndex,
} from 'drizzle-orm/pg-core';
import { organization } from './identity.js';
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
    orgId: varchar('org_id', { length: 255 })
        .notNull()
        .references(() => organization.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id')
        .notNull()
        .references(() => uiWorkspaces.id, { onDelete: 'cascade' }),
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
    syncIntervalMinutes: integer('sync_interval_minutes').notNull().default(30),
    scheduleEnabled: boolean('schedule_enabled').notNull().default(true),
    // Timestamp of the last scheduled execution (set by SchedulerService)
    lastScheduledAt: timestamp('last_scheduled_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull().$onUpdate(() => new Date()),
}, (table) => [
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
    uniqueIndex('field_mapping_route_canonical_unique_idx').on(table.routeId, table.sourceCanonical),
    index('field_mapping_route_idx').on(table.routeId),
]);
