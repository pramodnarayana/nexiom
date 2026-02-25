import { pgTable, uuid, varchar, text, timestamp, jsonb, index, uniqueIndex, pgEnum } from 'drizzle-orm/pg-core';

// Auth type enum — previously in provider.ts, now inlined here since the provider table is dropped
export const authTypeEnum = pgEnum('auth_type_enum', ['OAUTH2', 'API_KEY', 'BASIC']);

// Tenants table and associated identity schema are physically isolated per tenant or live in a separate DB.
// Drizzle foreign keys pointing to "organization" are handled directly in raw migrations (0000_...sql)
// rather than strict drizzle-orm foreignKey() constraints here to allow cross-database resolution.

export const tenants = pgTable('tenant', {
    id: uuid('id').primaryKey(),
});

export const connectionStatusEnum = pgEnum('connection_status_enum', ['ACTIVE', 'INACTIVE', 'REVOKED', 'EXPIRED']);

export const AppConnectionStatus = {
    ACTIVE: 'ACTIVE',
    INACTIVE: 'INACTIVE',
    EXPIRED: 'EXPIRED',
    REVOKED: 'REVOKED',
} as const;
export type AppConnectionStatus = (typeof AppConnectionStatus)[keyof typeof AppConnectionStatus];

export const appConnections = pgTable('app_connection', {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull(), // Uses organization(id) in SQL migrations
    appName: varchar('app_name', { length: 100 }).notNull(), // 'salesforce', 'quickbooks' — validated against PROVIDER_REGISTRY in code
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
    index('tenant_status_idx').on(table.tenantId, table.status),
    uniqueIndex('tenant_app_connection_unique_idx').on(table.tenantId, table.appName, table.connectionKey),
]);