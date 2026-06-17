import {
    pgTable,
    pgEnum,
    uuid,
    varchar,
    jsonb,
    timestamp,
    index,
    integer,
    text,
    check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type { OutboxStatus } from '../tenant/pipeline.js';

export const registryOutboxActionEnum = pgEnum('registry_outbox_action_enum', [
    'UPSERT',
    'DELETE',
    'APPLY',
]);

export const registryOutboxEntityEnum = pgEnum('registry_outbox_entity_enum', [
    'APP_CONNECTION',
    'UI_WORKSPACE',
    'INTEGRATION_STITCH',
    'FIELD_MAPPING',
    'SCHEMA_PROVISION',
]);

/**
 * GLOBAL REGISTRY OUTBOX
 * 
 * Transactional outbox for federated database replication.
 * Written inside the same DB transaction as a mutation to app_connection,
 * integration_stitch, or field_mapping in the Global DB.
 * 
 * The RegistryReplicationWorker polls this table, reads the payload, 
 * looks up the target Tenant DB via tenant_storage_registry, and performs 
 * an idempotent UPSERT/DELETE in the Tenant DB to ensure the Local Shard 
 * strictly matches the Global Catalog.
 */
export const globalRegistryOutbox = pgTable('global_registry_outbox', {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: varchar('tenant_id', { length: 255 }).notNull(),
    entityType: registryOutboxEntityEnum('entity_type').notNull(),
    entityId: uuid('entity_id').notNull(),
    action: registryOutboxActionEnum('action').notNull(),
    
    // The serialized row data from the Global DB to be upserted into the Tenant DB
    payload: jsonb('payload').notNull().default({}),

    status: text('status')
        .$type<OutboxStatus>()
        .notNull()
        .default('PENDING'),
    attempts: integer('attempts').notNull().default(0),
    nextRetryAt: timestamp('next_retry_at', { withTimezone: true })
        .notNull()
        .default(sql`now()`),
    errorMessage: varchar('error_message', { length: 1000 }),
    
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull().$onUpdate(() => new Date()),
}, (table) => [
    index('registry_outbox_poll_idx')
        .on(table.nextRetryAt)
        .where(sql`status = 'PENDING' OR status = 'RETRY'`),
    index('registry_outbox_tenant_idx').on(table.tenantId),
    check('registry_outbox_status_check', sql`status IN ('PENDING', 'RETRY', 'FAIL', 'SUCCESS', 'PROCESSING')`),
]);
