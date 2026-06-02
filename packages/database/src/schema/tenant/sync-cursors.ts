import {
    pgTable,
    uuid,
    varchar,
    jsonb,
    timestamp,
    index,
    unique,
} from 'drizzle-orm/pg-core';

/**
 * SYNC CURSORS — Polling State (data-plane, tenant schema)
 *
 * Stores the Singer-style bookmark for each (data_source, stream) pair.
 * Written exclusively by the SchedulerWorker; read at the start of every
 * poll run to calculate the safe polling window.
 *
 * state_document shape:
 *   {
 *     "bookmarks": {
 *       "Account": {
 *         "replication_key": "LastModifiedDate",
 *         "replication_key_value": "2026-03-22T09:45:00.000Z",
 *         "version": 1
 *       }
 *     }
 *   }
 */
export const syncCursors = pgTable('sync_cursors', {
    id: uuid('id').defaultRandom().primaryKey(),
    /**
     * References data_sources.id in the global DB.
     * Keyed per data source, so a connection maintains a single high-water mark
     * regardless of how many stitches consume its data.
     */
    dataSourceId: uuid('data_source_id').notNull(),
    /** Vendor object / stream name (e.g. 'Account', 'rtms__Load__c') */
    streamName: varchar('stream_name', { length: 200 }).notNull(),
    /**
     * Singer-style state document (aligned with singer-python state.py conventions).
     * Default shape mirrors SyncStateDocument so no field is undefined on first read:
     *   bookmarks       — per-stream high-water marks + pagination offsets
     *   versions        — per-stream ACTIVATE_VERSION counters (top-level, not inside bookmarks)
     *   currently_syncing — set during a poll run; used for crash-resume detection
     */
    stateDocument: jsonb('state_document').notNull().default({ bookmarks: {}, versions: {}, currently_syncing: null }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull().$onUpdate(() => new Date()),
}, (table) => [
    unique('sync_cursors_unique_constraint').on(table.dataSourceId, table.streamName),
    index('idx_sync_cursors_ds').on(table.dataSourceId),
]);
