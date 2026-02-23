import { pgTable, uuid, varchar, text, jsonb, timestamp, uniqueIndex, foreignKey } from 'drizzle-orm/pg-core';
import { tenants } from './tenant';

// Stores the BYOA (Bring Your Own App) OAuth credentials for a tenant
export const appCredentials = pgTable('app_credential', {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    appName: varchar('app_name', { length: 100 }).notNull(),

    // The OAuth Client ID
    clientId: text('client_id').notNull(),

    // The OAuth Client Secret (Encrypted via EncryptionService)
    encryptedClientSecret: text('encrypted_client_secret').notNull(),

    // Any extra fields required by the vendor (e.g., custom domains)
    setupMetadata: jsonb('setup_metadata').default({}),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull().$onUpdate(() => new Date()),
}, (table) => [
    // A tenant can only have one set of global BYOA credentials per application
    uniqueIndex('tenant_app_credential_unique_idx').on(table.tenantId, table.appName),
    // Cascade deletes if a tenant is removed
    foreignKey({
        columns: [table.tenantId],
        foreignColumns: [tenants.id],
        name: 'app_credential_tenant_id_tenants_id_fk'
    }).onDelete('cascade'),
]);
