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
} from 'drizzle-orm/pg-core';

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
]);

export const pipelineLayerEnum = pgEnum('pipeline_layer_enum', [
    'L1', 'L2', 'L3', 'L4', 'L5', 'L6',
]);

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
     * GIN index on payload enables sub-100ms JSONB field searches.
     */
    const inboundGateway = schema.table('inbound_gateway', {
        id: uuid('id').defaultRandom().primaryKey(),
        traceId: uuid('trace_id').notNull().unique(),
        connectionId: uuid('connection_id').notNull(),
        // Object type detected at ingestion for early-stage routing
        objectType: varchar('object_type', { length: 100 }),
        payload: jsonb('payload').notNull(),
        headers: jsonb('headers'),
        // Vendor batch/event ID — used for idempotency
        extReqId: varchar('ext_req_id', { length: 255 }),
        status: pipelineStatusEnum('status').notNull().default('RECEIVED'),
        createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    }, (table) => [
        uniqueIndex('idx_l1_ext_id').on(table.connectionId, table.extReqId),
        index('idx_l1_object_type').on(table.objectType),
        index('idx_l1_status').on(table.status),
        index('idx_l1_payload_gin').using('gin', table.payload),
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
        connectionId: uuid('connection_id').notNull(),
        traceId: uuid('trace_id').notNull(),
        srcReqTraceId: uuid('src_req_trace_id').notNull(),
        sourceId: varchar('source_id', { length: 255 }).notNull(),
        entityType: varchar('entity_type', { length: 100 }).notNull(),
        data: jsonb('data').notNull(),
        version: integer('version').notNull().default(1),
        updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull().$onUpdate(() => new Date()),
    }, (table) => [
        uniqueIndex('idx_l2_unique_entity').on(table.connectionId, table.entityType, table.sourceId),
        index('idx_l2_trace').on(table.traceId),
        index('idx_l2_src_req').on(table.srcReqTraceId),
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
        // Durable published marker — set atomically when the record is enqueued
        // to NormalizedQueue. Null = not yet enqueued; non-null = already published.
        // Retries check this column before calling queueService.send() to make
        // L3 enqueue idempotent without a separate outbox table.
        publishedAt: timestamp('published_at', { withTimezone: true }),
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
        reqPayload: jsonb('req_payload').notNull(),
        resPayload: jsonb('res_payload'),
        statusCode: integer('status_code'),
        status: pipelineStatusEnum('status').notNull().default('PENDING'),
        attemptCount: integer('attempt_count').notNull().default(0),
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
        connectionId: uuid('connection_id').notNull(),
        entityType: varchar('entity_type', { length: 100 }).notNull(),
        // ISO-8601 or vendor-specific cursor (offset, page token, etc.)
        lastSyncTimestamp: varchar('last_sync_timestamp', { length: 255 }).notNull(),
        updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull().$onUpdate(() => new Date()),
    }, (table) => [
        uniqueIndex('idx_unique_cursor').on(table.connectionId, table.entityType),
    ]);

    /**
     * DELIVERY OUTBOX
     *
     * Transactional outbox for reliable queue handoff.
     */
    const deliveryOutbox = schema.table('delivery_outbox', {
        id: uuid('id').defaultRandom().primaryKey(),
        payload: jsonb('payload').notNull(),
        status: pipelineStatusEnum('status').notNull().default('PENDING'),
        createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
        deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    });

    return {
        inboundGateway,
        replicaEntity,
        normalizedEntity,
        outboundGateway,
        syncLog,
        syncCursor,
        deliveryOutbox,
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
