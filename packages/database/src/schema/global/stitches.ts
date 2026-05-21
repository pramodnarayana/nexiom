import {
    pgTable,
    pgEnum,
    uuid,
    varchar,
    text,
    smallint,
    integer,
    boolean,
    jsonb,
    timestamp,
    index,
    uniqueIndex,
    foreignKey,
    check,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';
import { dataSources } from './data-sources.js';
import { uiWorkspaces } from './workspace.js';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const stitchStatusEnum = pgEnum('stitch_status_enum', ['ACTIVE', 'PAUSED', 'ARCHIVED']);

/**
 * Allowed sync intervals in minutes.
 * Stored as an integer so the scheduler can use it directly:
 *   BullMQ: `repeat: { every: syncIntervalMinutes * 60_000 }`
 * Support team can override per-stitch via the admin API.
 */
export const SYNC_INTERVAL_OPTIONS = [30, 60, 120, 240, 360, 720, 1440] as const;
export type SyncIntervalMinutes = typeof SYNC_INTERVAL_OPTIONS[number];

// ---------------------------------------------------------------------------

/**
 * INTEGRATION STITCHES
 *
 * Defines the logical sync path between a source and destination connection.
 * Lives at the workspace level — one workspace can have many stitches.
 *
 * `syncCondition` is a JSONB array of rule objects evaluated at L4:
 *   [{ "field": "Region", "op": "eq", "value": "US", "logic": "AND" }]
 *
 * `sourceObject` / `targetObject` are vendor object names resolved via
 * the Metadata Discovery Service (e.g. 'rtms__Load__c', 'Invoice').
 */
export const integrationStitches = pgTable('integration_stitch', {
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
    // FKs to dataSources are defined as explicit named foreignKey() constraints
    // below (stitch_src_connection_fk / stitch_dest_connection_fk) — no inline
    // .references() here to avoid duplicate constraints on the same columns.
    srcDataSourceId: uuid('src_data_source_id').notNull(),
    destDataSourceId: uuid('dest_data_source_id').notNull(),
    // Vendor object names resolved at stitch-creation time via describe API
    sourceObject: varchar('source_object', { length: 255 }).notNull(),
    targetObject: varchar('target_object', { length: 255 }).notNull(),
    // Array of filter rules evaluated at L4 (Fan-Out Decision)
    syncCondition: jsonb('sync_condition').notNull().default([]),
    status: stitchStatusEnum('status').notNull().default('ACTIVE'),
    // Scheduler — how often the poller fires for this stitch.
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
    // Guarantees the workspace actually belongs to the org on this stitch —
    // makes mismatched (workspaceId=ws-B, orgId=org-A) impossible at DB level.
    foreignKey({
        columns: [table.workspaceId, table.orgId],
        foreignColumns: [uiWorkspaces.id, uiWorkspaces.orgId],
        name: 'stitch_workspace_org_fk',
    }).onDelete('cascade'),
    // Cascade deletes when either the source or destination data source is removed
    foreignKey({
        columns: [table.srcDataSourceId],
        foreignColumns: [dataSources.id],
        name: 'stitch_src_data_source_fk',
    }).onDelete('cascade'),
    foreignKey({
        columns: [table.destDataSourceId],
        foreignColumns: [dataSources.id],
        name: 'stitch_dest_data_source_fk',
    }).onDelete('cascade'),
    // Reject zero/negative intervals at the DB layer
    check('sync_interval_minutes_positive', sql`${table.syncIntervalMinutes} > 0`),
    // Case-insensitive uniqueness per workspace — same name allowed across workspaces
    uniqueIndex('stitch_name_workspace_unique_idx').on(table.workspaceId, sql`lower(${table.name})`),
    index('stitch_workspace_idx').on(table.workspaceId),
    index('stitch_org_idx').on(table.orgId),
    index('stitch_src_ds_idx').on(table.srcDataSourceId),
    index('stitch_dest_ds_idx').on(table.destDataSourceId),
    index('stitch_status_idx').on(table.orgId, table.status),
]);

/**
 * FIELD MAPPINGS
 *
 * The field-level transformation template for a stitch.
 *
 * `sourceCanonical` is the canonical type this mapping applies to
 * (e.g. 'TMS_INVOICE'), scoping mappings per object type on a stitch.
 *
 * `mappingRules` is a JSONB array of JSONPath transformation rules:
 *   [{ "src": "$.rtms__Total_Amount__c", "dest": "$.TotalAmt" }]
 */
export const fieldMappings = pgTable('field_mapping', {
    id: uuid('id').defaultRandom().primaryKey(),
    // No inline .references() — FK is declared as an explicit named foreignKey()
    // below to match the migration constraint name exactly and avoid Drizzle
    // drift detection generating a duplicate FK on the same column.
    stitchId: uuid('stitch_id').notNull(),
    // The canonical object type this template applies to
    sourceCanonical: varchar('source_canonical', { length: 100 }).notNull(),
    // Array of { src: JSONPath, dest: JSONPath, transform?: expression }
    mappingRules: jsonb('mapping_rules').notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull().$onUpdate(() => new Date()),
}, (table) => [
    foreignKey({
        columns: [table.stitchId],
        foreignColumns: [integrationStitches.id],
        name: 'field_mapping_stitch_id_integration_stitch_id_fk',
    }).onDelete('cascade'),
    // uniqueIndex on (stitchId, sourceCanonical) already covers stitchId lookups;
    // a separate index on stitchId alone would add write/storage overhead for no gain.
    uniqueIndex('field_mapping_stitch_canonical_unique_idx').on(table.stitchId, table.sourceCanonical),
]);



// ---------------------------------------------------------------------------
// Scheduler Outbox — durable transactional outbox for Windmill schedule sync
// ---------------------------------------------------------------------------

export const schedulerOutboxActionEnum = pgEnum('scheduler_outbox_action_enum', [
  'CREATED',
  'UPDATED',
  'DELETED',
]);

export const schedulerOutboxStatusEnum = pgEnum('scheduler_outbox_status_enum', [
  'PENDING',
  'PROCESSING',
  'SUCCEEDED',
  'FAILED',
]);

/**
 * SCHEDULER OUTBOX
 *
 * Transactional outbox for Windmill schedule synchronisation.
 * Written inside the same DB transaction as the stitch mutation that triggers
 * it, guaranteeing at-least-once delivery to Windmill even if the process
 * crashes immediately after the DB write.
 *
 * OutboxWorkerService polls this table every 10 s using SELECT … FOR UPDATE
 * SKIP LOCKED so multiple API pods do not double-process the same record.
 * Failures are retried with exponential back-off up to MAX_OUTBOX_ATTEMPTS.
 */
export const schedulerOutbox = pgTable('scheduler_outbox', {
  id: uuid('id').defaultRandom().primaryKey(),
  /**
   * The stitch whose Windmill schedule should be synced.
   * No inline .references() — FK is declared as an explicit named foreignKey()
   * in the table constraints below (scheduler_outbox_stitch_fk) to keep the
   * constraint name stable across schema regenerations.
   *
   * ON DELETE CASCADE: hard-deletes of a stitch (rare; normal removal is a
   * soft-archive to status='ARCHIVED') auto-clean orphaned outbox rows.
   * The remove() method always soft-archives, so this only fires if a stitch
   * row is forcibly deleted directly in the DB or via a cascade from a
   * workspace/connection delete.
   */
  stitchId: uuid('stitch_id').notNull(),
  /** What the scheduler should do for this stitch. */
  action: schedulerOutboxActionEnum('action').notNull(),
  /** Lifecycle state managed by OutboxWorkerService. */
  status: schedulerOutboxStatusEnum('status').notNull().default('PENDING'),
  /** How many delivery attempts have been made (incremented before each try). */
  attempts: smallint('attempts').notNull().default(0),
  /**
   * Earliest timestamp at which this record may be picked up.
   * Set to NOW() on insert; updated to NOW() + back-off after each failure.
   */
  nextRetryAt: timestamp('next_retry_at', { withTimezone: true })
    .notNull()
    .default(sql`now()`),
  /** Last error message recorded on failure. */
  lastError: text('last_error'),
  /** Timestamp of final processing (succeeded or permanently failed). */
  processedAt: timestamp('processed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  foreignKey({
    columns: [table.stitchId],
    foreignColumns: [integrationStitches.id],
    name: 'scheduler_outbox_stitch_fk',
  }).onDelete('cascade'),
  // Partial index covering only pending rows — excludes the large succeeded/failed
  // population so the poll query (WHERE status='PENDING' AND next_retry_at<=NOW())
  // stays fast as the table grows.
  index('scheduler_outbox_poll_idx')
    .on(table.nextRetryAt)
    .where(sql`status = 'PENDING'`),
  index('scheduler_outbox_stitch_idx').on(table.stitchId),
]);

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

export const integrationStitchesRelations = relations(integrationStitches, ({ one, many }) => ({
    workspace: one(uiWorkspaces, {
        fields: [integrationStitches.workspaceId],
        references: [uiWorkspaces.id],
    }),
    srcDataSource: one(dataSources, {
        fields: [integrationStitches.srcDataSourceId],
        references: [dataSources.id],
        relationName: 'stitch_src_data_source',
    }),
    destDataSource: one(dataSources, {
        fields: [integrationStitches.destDataSourceId],
        references: [dataSources.id],
        relationName: 'stitch_dest_data_source',
    }),
    fieldMappings: many(fieldMappings),
}));

export const fieldMappingsRelations = relations(fieldMappings, ({ one }) => ({
    stitch: one(integrationStitches, {
        fields: [fieldMappings.stitchId],
        references: [integrationStitches.id],
    }),
}));
