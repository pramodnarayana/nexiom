import { pgTable, uuid, varchar, text, timestamp, jsonb, index, uniqueIndex, integer, boolean } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { envTypeEnum } from './routing.js';

/**
 * Enterprise Grade Data Source.
 *
 * One row = one named logical data source (e.g. "Salesforce Org 123").
 * Credentials are decoupled into the `credentials` table.
 */
export const dataSources = pgTable('data_source', {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: text('tenant_id').notNull(),

    // Provider name (e.g. "salesforce")
    appName: varchar('app_name', { length: 100 }).notNull(),

    // User-defined machine-readable identifier — unique per tenant.
    externalId: varchar('external_id', { length: 255 }).notNull(),

    // Human-readable label shown in the UI
    displayName: varchar('display_name', { length: 255 }).notNull(),

    // Sandbox vs Production
    envType: envTypeEnum('env_type').notNull().default('PRODUCTION'),

    // The stable physical identifier of the vendor tenant (e.g., Salesforce org ID, QuickBooks realmId).
    // This allows auto-linking new credentials to the same logical data source.
    organizationId: varchar('organization_id', { length: 255 }),

    // Plain-text metadata (e.g., instance_url, appProfile, environment labels)
    metadata: jsonb('metadata').default({}).notNull(),

    schemaPlan: varchar('schema_plan', { length: 64 }).notNull().default('NAMESPACE_ONLY'),

    // The physical PostgreSQL schema name for this data source's tenant workspace.
    schemaName: varchar('schema_name', { length: 100 }),

    // Scheduler — how often the poller fires for this connection.
    // Default: 30 minutes. Support team configurable via admin API.
    syncIntervalMinutes: integer('sync_interval_minutes').notNull().default(30),
    scheduleEnabled: boolean('schedule_enabled').notNull().default(true),
    // Timestamp of the last scheduled execution (set by SchedulerService)
    lastScheduledAt: timestamp('last_scheduled_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull().$onUpdate(() => new Date()),
}, (table) => [
    index('ds_tenant_idx').on(table.tenantId),
    uniqueIndex('ds_tenant_external_id_idx').on(table.tenantId, table.externalId),
    uniqueIndex('ds_tenant_app_display_name_lower_idx').on(table.tenantId, table.appName, sql`lower(${table.displayName})`),
    // Unique index to prevent two logical data sources from pointing to the exact same physical vendor instance
    // Note: NULLs are allowed (for apps that don't have a stable tenant ID) and are not considered equal by Postgres
    uniqueIndex('ds_tenant_organization_id_idx').on(table.tenantId, table.appName, table.envType, table.organizationId),
]);

export type InsertDataSource = typeof dataSources.$inferInsert;
export type SelectDataSource = typeof dataSources.$inferSelect;
