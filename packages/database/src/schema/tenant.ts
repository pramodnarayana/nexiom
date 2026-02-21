import { pgTable, uuid, varchar, text, timestamp, jsonb, index, uniqueIndex, pgEnum, foreignKey } from 'drizzle-orm/pg-core';
import { authTypeEnum, providers } from './provider';

// Since the tenants table physically lives in a different schema/database,
// we just define a raw FK in the migration or omit it in Drizzle code while keeping the reference loose.
// But the prompt states: "change the constraint to reference organization(id)".
// So we define it via foreignKey if the org table is in the same schema, or raw migration. Let's just create a raw FK definition or omit the strict drizzle FK to allow migration SQL to handle it, but we can do a dummy reference here or raw query.
// Wait, the prompt implies "tenants" was changed to "organization". That happens in the raw SQL.

export const connectionStatusEnum = pgEnum('connection_status_enum', ['ACTIVE', 'INACTIVE', 'REVOKED', 'EXPIRED']);

export const AppConnectionStatus = {
    ACTIVE: 'ACTIVE',
    EXPIRED: 'EXPIRED',
    REVOKED: 'REVOKED',
} as const;
export type AppConnectionStatus = (typeof AppConnectionStatus)[keyof typeof AppConnectionStatus];

export const appConnections = pgTable('app_connection', {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull(), // Uses organization(id) in SQL migrations
    providerId: uuid('provider_id').references(() => providers.id, { onDelete: 'restrict', onUpdate: 'cascade' }).notNull(),
    appName: varchar('app_name', { length: 100 }).notNull(), // Denormalized 'quickbooks'
    authType: authTypeEnum('auth_type').notNull(), // 'OAUTH2', 'API_KEY', 'BASIC'

    // Encrypted Payload (Contains access_token, refresh_token, or api_key)
    encryptedCredentials: text('encrypted_credentials').notNull(),

    // Extracted for fast querying without decryption
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    status: connectionStatusEnum('status').default('ACTIVE').notNull(), // ACTIVE, INACTIVE, REVOKED, EXPIRED

    // Public metadata (e.g., connected account email, realmId)
    metadata: jsonb('metadata').default({}),

    // Stable per-connection key for multi-realm providers (e.g., QB realmId).
    // Defaults to 'default' for single-realm providers like Salesforce.
    connectionKey: varchar('connection_key', { length: 255 }).default('default').notNull(),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull().$onUpdate(() => new Date()),
}, (table) => [
    index('app_name_idx').on(table.appName),
    uniqueIndex('tenant_app_connection_unique_idx').on(table.tenantId, table.appName, table.connectionKey),
]);