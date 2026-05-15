import {
    pgTable,
    uuid,
    varchar,
    jsonb,
    timestamp,
    index,
    uniqueIndex,
} from 'drizzle-orm/pg-core';

/**
 * SYNC CURSORS — Polling State (data-plane, tenant schema)
 *
 * Stores the Singer-style bookmark for each (connection, stream) pair.
 * Written exclusively by the SchedulerWorker; read at the start of every
 * poll run to calculate the safe polling window.
 *
 * Intentionally separate from ws_{id}.sync_cursor (per-tenant workspace
 * schema, written by ReplicaService to track L2→L3 replication state).
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
    // Keyed per stitch (not per connection) so two stitches that share the same
    // source connection + stream name maintain independent cursors and do not
    // advance each other's high-water mark.
    // NOTE: stitchId refers to the global integration_stitch table.
    // There is no hard FK here because cross-database FKs are not supported.
    stitchId: uuid('stitch_id').notNull(),
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
    uniqueIndex('sync_cursors_stitch_stream_unique_idx').on(table.stitchId, table.streamName),
    index('sync_cursors_stitch_idx').on(table.stitchId),
]);
