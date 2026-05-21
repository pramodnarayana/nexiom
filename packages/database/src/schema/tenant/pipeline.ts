import {
    pgSchema,
    pgEnum,
    uuid,
    varchar,
    integer,
    jsonb,
    timestamp,
    index,
    uniqueIndex,
    text,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// Enums (shared across pipeline layers)
// ---------------------------------------------------------------------------

export const pipelineStatusEnum = pgEnum('pipeline_status_enum', [
    'RECEIVED',
    'PROCESSING',
    'REPLICATED',
    'NORMALIZED',
    'SKIPPED',    // sync condition did not match (fan-out filter)
    'PENDING',
    'SUCCESS',
    'FAIL',
    'RETRY',
    'DISMISSED',  // operator explicitly dismissed a failed delivery — no further retries
    'DEFERRED_DEPENDENCY', // paused waiting for dependency
]);

export const pipelineLayerEnum = pgEnum('pipeline_layer_enum', [
    'L1', 'L2', 'L3', 'L4', 'L5', 'L6',
]);

export const OutboundGatewayStatus = ['PENDING', 'PROCESSING', 'SUCCESS', 'FAIL', 'RETRY', 'DISMISSED', 'DEFERRED_DEPENDENCY'] as const;
export type OutboundGatewayStatus = (typeof OutboundGatewayStatus)[number];

export const OutboxStatus = ['PENDING', 'PROCESSING', 'SUCCESS', 'FAIL', 'RETRY'] as const;
export type OutboxStatus = (typeof OutboxStatus)[number];

// ---------------------------------------------------------------------------
// Tenant Schema Builder
//
// Data-plane tables live in isolated per-connection Postgres schemas
// (e.g. ws_sf_101, ws_qb_us_202) provisioned by the DBManager.
//
// `buildTenantSchema(schemaName)` returns typed Drizzle table references
// for a given schema, enabling type-safe queries with SET search_path.
// ---------------------------------------------------------------------------

/**
 * Allowed schema name pattern — must be provisioned by DBManager.
 * Enforced before passing to pgSchema() to prevent SQL injection via
 * untrusted schema names reaching the Postgres identifier quoting path.
 */
export const TENANT_SCHEMA_PATTERN = /^ws_[a-z0-9_]+$/;

/**
 * Asserts that a schema name is safe to pass to pgSchema() / SET LOCAL search_path.
 * Throws if the name was not provisioned by DBManager (wrong prefix or characters).
 * Export this to reuse the same check in StorageResolverService and DBManager.
 */
export function assertValidSchemaName(schemaName: string): void {
    if (!TENANT_SCHEMA_PATTERN.test(schemaName)) {
        throw new Error(
            `Invalid tenant schema name "${schemaName}". ` +
            `Must match ${TENANT_SCHEMA_PATTERN.toString()} — only DBManager-provisioned names are allowed.`
        );
    }
}

export function buildTenantSchema(schemaName: string) {
    assertValidSchemaName(schemaName);
    const schema = pgSchema(schemaName);

    /**
     * LAYER 1 — INBOUND GATEWAY
     *
     * Captures every raw transmission exactly as received (webhook or poll).
     * Immutable after write — the permanent "source evidence" record.
     * GIN index on request enables sub-100ms JSONB field searches.
     */
    const inboundGateway = schema.table('inbound_gateway', {
        id: uuid('id').defaultRandom().primaryKey(),
        traceId: uuid('trace_id').notNull().unique(),
        dataSourceId: uuid('data_source_id').notNull(),
        // Object type detected at ingestion for early-stage routing
        objectType: varchar('object_type', { length: 100 }),
        request: jsonb('request').notNull(),
        response: jsonb('response'),
        headers: jsonb('headers'),
        // Vendor batch/event ID — used for idempotency
        extReqId: varchar('ext_req_id', { length: 255 }),
        status: pipelineStatusEnum('status').notNull().default('RECEIVED'),
        createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    }, (table) => [
        uniqueIndex('idx_l1_ext_id').on(table.dataSourceId, table.extReqId),
        index('idx_l1_object_type').on(table.objectType),
        index('idx_l1_status').on(table.status),
        index('idx_l1_request_gin').using('gin', table.request),
    ]);

    /**
     * PIPELINE RACE CONDITION LOCKS
     *
     * Prevents an UPDATE event from being processed while a CREATE event
     * for the same entity is still inflight (preventing duplicate writes
     * or missing ID injection).
     */
    const activeSyncLocks = schema.table('active_sync_locks', {
        id: uuid('id').defaultRandom().primaryKey(),
        dataSourceId: uuid('data_source_id').notNull(),
        entityId: varchar('entity_id', { length: 255 }).notNull(),
        lockedByTraceId: uuid('locked_by_trace_id').notNull(),
        expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
        createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    }, (table) => [
        uniqueIndex('idx_sync_lock_unique').on(table.dataSourceId, table.entityId),
    ]);

    /**
     * LAYER 2 — UNIVERSAL REPLICA
     *
     * Parsed, structured state store. Batches from L1 are split into
     * individual entity rows here. Unique on (entityType, sourceId)
     * for deduplication — re-processing the same record is an upsert.
     *
     * `srcReqTraceId` links back to the L1 transmission that produced it.
     * `version` increments on every update for optimistic concurrency.
     */
    const replicaEntity = schema.table('replica_entity', {
        id: uuid('id').defaultRandom().primaryKey(),
        dataSourceId: uuid('data_source_id').notNull(),
        traceId: uuid('trace_id').notNull(),
        entityId: varchar('entity_id', { length: 255 }).notNull(),
        entityType: varchar('entity_type', { length: 100 }).notNull(),
        data: jsonb('data').notNull(),
        version: integer('version').notNull().default(1),
        createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
        updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull().$onUpdate(() => new Date()),
    }, (table) => [
        uniqueIndex('idx_l2_unique_entity').on(table.dataSourceId, table.entityType, table.entityId),
        index('idx_l2_trace').on(table.traceId),
        index('idx_l2_data_gin').using('gin', table.data),
    ]);

    /**
     * LAYER 3 — NORMALIZED ENTITY
     *
     * The record converted into the FluxNex Canonical Model
     * (e.g. TMS_INVOICE, TMS_LOAD). Decouples source schema changes
     * from downstream mapping logic.
     */
    const normalizedEntity = schema.table('normalized_entity', {
        id: uuid('id').defaultRandom().primaryKey(),
        traceId: uuid('trace_id').notNull(),
        replicaId: uuid('replica_id').notNull(),
        canonicalType: varchar('canonical_type', { length: 100 }).notNull(),
        data: jsonb('data').notNull(),
        createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    }, (table) => [
        index('idx_l3_trace').on(table.traceId),
        uniqueIndex('idx_l3_replica').on(table.replicaId),
        index('idx_l3_canonical_type').on(table.canonicalType),
        index('idx_l3_data_gin').using('gin', table.data),
    ]);

    /**
     * LAYERS 5 & 6 — OUTBOUND GATEWAY
     *
     * Written by the Fan-Out engine (L4) when a route matches, then
     * updated by the Delivery Engine (L5) with the vendor API response.
     * `routeId` scopes the record to the specific route that matched.
     */
    const outboundGateway = schema.table('outbound_gateway', {
        id: uuid('id').defaultRandom().primaryKey(),
        traceId: uuid('trace_id').notNull(),
        routeId: uuid('route_id').notNull(),
        dataSourceId: uuid('data_source_id').notNull(),
        payload: jsonb('payload').notNull(),
        response: jsonb('response'),
        statusCode: integer('status_code'),
        status: text('status').$type<OutboundGatewayStatus>().notNull().default('PENDING'),
        attempts: integer('attempts').notNull().default(0),
        lastError: text('last_error'),
        nextRetryAt: timestamp('next_retry_at', { withTimezone: true }),
        createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
        updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull().$onUpdate(() => new Date()),
    }, (table) => [
        index('idx_l6_trace').on(table.traceId),
        index('idx_l6_route').on(table.routeId),
        index('idx_l6_status').on(table.status),
        uniqueIndex('idx_l6_trace_route').on(table.traceId, table.routeId),
    ]);

    /**
     * SYNC LOG — Operational Timeline
     *
     * One row per layer transition per trace. Powers the Route Intelligence
     * dashboard (L1→L6 pipeline visualization with per-layer duration).
     */
    const syncLog = schema.table('sync_log', {
        id: uuid('id').defaultRandom().primaryKey(),
        traceId: uuid('trace_id').notNull(),
        // Nullable — early-layer entries (L1/L2) may be logged before a route is resolved
        routeId: uuid('route_id'),
        layer: pipelineLayerEnum('layer').notNull(),
        status: pipelineStatusEnum('status').notNull(),
        durationMs: integer('duration_ms'),
        timestamp: timestamp('timestamp', { withTimezone: true }).defaultNow().notNull(),
    }, (table) => [
        index('idx_log_trace').on(table.traceId),
        index('idx_log_route').on(table.routeId),
        index('idx_log_layer').on(table.traceId, table.layer),
        uniqueIndex('uq_sync_log_routed').on(table.traceId, table.routeId, table.layer, table.status).where(sql`${table.routeId} IS NOT NULL`),
        uniqueIndex('uq_sync_log_unrouted').on(table.traceId, table.layer, table.status).where(sql`${table.routeId} IS NULL`),
    ]);

    /**
     * SYNC CURSOR — Polling State
     *
     * Tracks the high-water mark for each (connection, entityType) pair.
     * The Poller advances the cursor only after the DB commit succeeds,
     * guaranteeing at-least-once delivery on restart.
     */
    const syncCursor = schema.table('sync_cursor', {
        id: uuid('id').defaultRandom().primaryKey(),
        dataSourceId: uuid('data_source_id').notNull(),
        entityType: varchar('entity_type', { length: 100 }).notNull(),
        // ISO-8601 or vendor-specific cursor (offset, page token, etc.)
        lastSyncTimestamp: varchar('last_sync_timestamp', { length: 255 }).notNull(),
        updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull().$onUpdate(() => new Date()),
    }, (table) => [
        uniqueIndex('idx_unique_cursor').on(table.dataSourceId, table.entityType),
    ]);

    /**
     * INBOUND OUTBOX
     *
     * Transactional outbox pattern used to safely decouple the L1 database
     * commit from the external queue handoff (L1 -> L2) to guarantee delivery.
     */
    const inboundOutbox = schema.table('inbound_outbox', {
        id: uuid('id').defaultRandom().primaryKey(),
        traceId: uuid('trace_id').notNull(),
        dataSourceId: uuid('data_source_id').notNull(),
        schemaName: varchar('schema_name', { length: 128 }).notNull().default(sql`current_schema()`),
        status: text('status').$type<OutboxStatus>().notNull().default('PENDING'),
        attempts: integer('attempts').notNull().default(0),
        lastError: varchar('last_error', { length: 500 }),
        nextRetryAt: timestamp('next_retry_at', { withTimezone: true }).defaultNow().notNull(),
        createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    }, (table) => [
        index('idx_inbound_outbox_claim')
            .on(table.status, table.nextRetryAt)
            .where(sql`status IN ('PENDING', 'PROCESSING', 'RETRY')`),
        uniqueIndex('idx_inbound_outbox_trace').on(table.traceId, table.dataSourceId),
    ]);

    /**
     * REPLICA OUTBOX
     *
     * Transactional outbox pattern used to safely decouple the L1/L2 database
     * commit from the external queue handoff (L2 -> L3) to guarantee delivery.
     */
    const replicaOutbox = schema.table('replica_outbox', {
        id: uuid('id').defaultRandom().primaryKey(),
        traceId: uuid('trace_id').notNull(),
        dataSourceId: uuid('data_source_id').notNull(),
        schemaName: varchar('schema_name', { length: 128 }).notNull().default(sql`current_schema()`),
        status: text('status').$type<OutboxStatus>().notNull().default('PENDING'),
        attempts: integer('attempts').notNull().default(0),
        lastError: varchar('last_error', { length: 500 }),
        nextRetryAt: timestamp('next_retry_at', { withTimezone: true }).defaultNow().notNull(),
        createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    }, (table) => [
        index('idx_replica_outbox_claim')
            .on(table.status, table.nextRetryAt)
            .where(sql`status IN ('PENDING', 'PROCESSING', 'RETRY')`),
        uniqueIndex('idx_replica_outbox_trace').on(table.traceId, table.dataSourceId),
    ]);

    /**
     * NORMALIZED OUTBOX
     *
     * Transactional outbox pattern used to safely decouple L3 commit
     * from external queue handoff (L3 -> L4) to guarantee delivery.
     */
    const normalizedOutbox = schema.table('normalized_outbox', {
        id: uuid('id').defaultRandom().primaryKey(),
        traceId: uuid('trace_id').notNull(),
        dataSourceId: uuid('data_source_id').notNull(),
        schemaName: varchar('schema_name', { length: 128 }).notNull().default(sql`current_schema()`),
        status: text('status').$type<OutboxStatus>().notNull().default('PENDING'),
        attempts: integer('attempts').notNull().default(0),
        lastError: varchar('last_error', { length: 500 }),
        nextRetryAt: timestamp('next_retry_at', { withTimezone: true }).defaultNow().notNull(),
        createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    }, (table) => [
        index('idx_normalized_outbox_claim')
            .on(table.status, table.nextRetryAt)
            .where(sql`status IN ('PENDING', 'PROCESSING', 'RETRY')`),
        uniqueIndex('idx_normalized_outbox_trace').on(table.traceId, table.dataSourceId),
    ]);

    return {
        activeSyncLocks,
        inboundGateway,
        inboundOutbox,
        replicaEntity,
        normalizedEntity,
        outboundGateway,
        syncLog,
        syncCursor,
        replicaOutbox,
        normalizedOutbox,
    };
}

// ---------------------------------------------------------------------------
// Static control-plane pipeline tables (public schema)
// These are queried without a dynamic search_path.
// ---------------------------------------------------------------------------

// connectorObjectProfiles is exported from './schema/connector_object_profiles.js'
// via the barrel (index.ts). Do NOT re-export it here — that creates an
// ambiguous duplicate export in the barrel.
// Import it directly in this file when needed:
//   import { connectorObjectProfiles } from './connector_object_profiles.js';
