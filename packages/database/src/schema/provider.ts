import { pgTable, uuid, varchar, text, jsonb, boolean, timestamp, pgEnum, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const authTypeEnum = pgEnum('auth_type_enum', ['OAUTH2', 'API_KEY', 'BASIC']);
/**
 * Provider catalog — stores configuration for all supported integration providers.
 * The frontend reads this to render connection UIs; the backend reads it for
 * OAuth URL resolution and provider validation.
 */
export const providers = pgTable('provider', {
    id: uuid('id').defaultRandom().primaryKey(),
    name: varchar('name', { length: 100 }).unique().notNull(),          // 'salesforce', 'quickbooks'
    displayName: varchar('display_name', { length: 255 }).notNull(),
    authType: authTypeEnum('auth_type').notNull(),     // 'OAUTH2', 'API_KEY', 'BASIC'

    // OAuth configuration (null for non-OAuth providers)
    authorizeUrl: text('authorize_url'),
    tokenUrl: text('token_url'),
    scopes: jsonb('scopes').$type<string[]>().default([]),
    // Dynamic form schema served to the frontend
    uiSchema: jsonb('ui_schema').$type<Record<string, unknown>>().default({}),

    // Frontend UI metadata for the Marketplace app directory
    description: text('description'),
    logoUrl: varchar('logo_url', { length: 255 }),
    category: varchar('category', { length: 100 }),

    // Soft-toggle: disable a provider without removing its row
    enabled: boolean('enabled').default(true).notNull(),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull().$onUpdate(() => new Date()),
}, (table) => [
    check('oauth_check', sql`auth_type != 'OAUTH2' OR (authorize_url IS NOT NULL AND token_url IS NOT NULL)`),
]);
