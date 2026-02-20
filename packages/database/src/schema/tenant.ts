import { pgTable, uuid, varchar, text, timestamp, jsonb, index } from 'drizzle-orm/pg-core';

export const appConnections = pgTable('app_connection', {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull(), // FK to tenants table
    appName: varchar('app_name', { length: 100 }).notNull(), // e.g., 'quickbooks'
    authType: varchar('auth_type', { length: 50 }).notNull(), // 'OAUTH2', 'API_KEY', 'BASIC'

    // Encrypted Payload (Contains access_token, refresh_token, or api_key)
    encryptedCredentials: text('encrypted_credentials').notNull(),

    // Extracted for fast querying without decryption
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    status: varchar('status', { length: 50 }).default('ACTIVE').notNull(), // ACTIVE, EXPIRED, REVOKED

    // Public metadata (e.g., connected account email, realmId)
    metadata: jsonb('metadata').default({}),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull().$onUpdate(() => new Date()),
}, (table) => [
    index('app_name_idx').on(table.appName),
    index('status_idx').on(table.status),
    index('tenant_app_name_idx').on(table.tenantId, table.appName),
]);