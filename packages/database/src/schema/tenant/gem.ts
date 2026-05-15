import {
    pgTable,
    uuid,
    varchar,
    timestamp,
    index,
    uniqueIndex,
} from 'drizzle-orm/pg-core';
import { integrationStitches } from '../global/stitches.js';
import { appConnections } from '../global/routing.js';

/**
 * GLOBAL ENTITY MAP (GEM)
 *
 * The authoritative cross-system ID registry. Written by the Delivery
 * Engine (L5/L6) after every successful vendor API call.
 *
 * Links a source record (e.g. Salesforce Invoice SF-999) to its
 * corresponding destination record (e.g. QuickBooks Invoice QB-456)
 * across apps, orgs, and regions.
 *
 * Used by the pipeline to detect updates vs creates on subsequent syncs
 * and by the Route Intelligence dashboard to display end-to-end linkage.
 */
export const globalEntityMap = pgTable('global_entity_map', {
    id: uuid('id').defaultRandom().primaryKey(),

    // Stitch that produced this mapping
    stitchId: uuid('stitch_id')
        .notNull()
        .references(() => integrationStitches.id, { onDelete: 'cascade' }),

    // ── Source side ──────────────────────────────────────────────────────────
    sourceAppName: varchar('source_app_name', { length: 100 }).notNull(),
    sourceAppId: uuid('source_app_id')
        .notNull()
        .references(() => appConnections.id, { onDelete: 'restrict' }),
    sourceOrgId: varchar('source_org_id', { length: 255 }).notNull(),
    sourceOrgName: varchar('source_org_name', { length: 255 }),
    sourceEntityType: varchar('source_entity_type', { length: 100 }).notNull(),  // e.g. 'Invoice'
    sourceEntityId: varchar('source_entity_id', { length: 255 }).notNull(),      // vendor record ID
    sourceRefLayer: varchar('source_ref_layer', { length: 10 }).notNull(),       // e.g. 'L2'
    sourceTraceId: uuid('source_trace_id').notNull(),

    // ── Destination side ─────────────────────────────────────────────────────
    destAppName: varchar('dest_app_name', { length: 100 }).notNull(),
    destAppId: uuid('dest_app_id')
        .notNull()
        .references(() => appConnections.id, { onDelete: 'restrict' }),
    destOrgId: varchar('dest_org_id', { length: 255 }).notNull(),
    destOrgName: varchar('dest_org_name', { length: 255 }),
    destEntityType: varchar('dest_entity_type', { length: 100 }).notNull(),
    destEntityId: varchar('dest_entity_id', { length: 255 }).notNull(),          // vendor record ID
    destRefLayer: varchar('dest_ref_layer', { length: 10 }).notNull(),           // e.g. 'L6'
    destTraceId: uuid('dest_trace_id').notNull(),

    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }).defaultNow().notNull().$onUpdate(() => new Date()),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
    // One mapping per (source record, destination app+type) pair per route
    uniqueIndex('gem_unique_mapping_idx').on(
        table.stitchId,
        table.sourceAppId,
        table.sourceEntityId,
        table.destAppId,
        table.destEntityType,
    ),
    index('gem_src_lookup_idx').on(table.sourceEntityId, table.sourceAppId),
    index('gem_dest_lookup_idx').on(table.destEntityId, table.destAppId),
    index('gem_source_app_idx').on(table.sourceAppId),
    index('gem_dest_app_idx').on(table.destAppId),
    index('gem_src_trace_idx').on(table.sourceTraceId),
    index('gem_dest_trace_idx').on(table.destTraceId),
    index('gem_stitch_idx').on(table.stitchId),
]);
