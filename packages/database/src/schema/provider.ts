import { pgTable, varchar, text, jsonb, boolean, timestamp } from 'drizzle-orm/pg-core';

/**
 * Provider catalog — stores configuration for all supported integration providers.
 * The frontend reads this to render connection UIs; the backend reads it for
 * OAuth URL resolution and provider validation.
 */
export const providers = pgTable('provider', {
    name: varchar('name', { length: 100 }).primaryKey(),          // 'salesforce', 'quickbooks'
    displayName: varchar('display_name', { length: 255 }).notNull(),
    authType: varchar('auth_type', { length: 50 }).notNull(),     // 'OAUTH2', 'API_KEY', 'BASIC'

    // OAuth configuration (null for non-OAuth providers)
    authorizeUrl: text('authorize_url'),
    tokenUrl: text('token_url'),
    scopes: jsonb('scopes').default([]),

    // Dynamic form schema served to the frontend
    uiSchema: jsonb('ui_schema').default({}),

    // Soft-toggle: disable a provider without removing its row
    enabled: boolean('enabled').default(true).notNull(),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull().$onUpdate(() => new Date()),
});
