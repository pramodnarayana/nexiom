import { pgTable, uuid, varchar, text, timestamp, jsonb, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { authTypeEnum } from './provider';

export const AppConnectionStatus = {
    ACTIVE: 'ACTIVE',
    EXPIRED: 'EXPIRED',
    REVOKED: 'REVOKED',
} as const;
export type AppConnectionStatus = (typeof AppConnectionStatus)[keyof typeof AppConnectionStatus];

export const appConnections = pgTable('app_connection', {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull(), // FK enforced at migration level — tenants table lives in identity/catalog schema (Database-per-Tenant)
    appName: varchar('app_name', { length: 100 }).notNull(), // e.g., 'quickbooks'
    authType: authTypeEnum('auth_type').notNull(), // 'OAUTH2', 'API_KEY', 'BASIC'

    // Encrypted Payload (Contains access_token, refresh_token, or api_key)
    encryptedCredentials: text('encrypted_credentials').notNull(),

    // Extracted for fast querying without decryption
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    status: varchar('status', { length: 50 }).default(AppConnectionStatus.ACTIVE).notNull(), // ACTIVE, EXPIRED, REVOKED

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