import { pgTable, uuid, varchar, boolean, timestamp, jsonb, text } from 'drizzle-orm/pg-core';

/**
 * Canonical registry of all Piece integrations available in the platform.
 *
 * Each row represents one integration package. `enabled` is the global
 * on/off switch — flip to false to disable a piece without a deployment.
 *
 * package_name  → npm package identifier used for dynamic import()
 * version       → informational; actual runtime uses the installed version
 */
export const pieces = pgTable('pieces', {
    id: uuid('id').defaultRandom().primaryKey(),

    /** Piece's canonical name — must match Piece.name in its source code */
    name: varchar('name', { length: 100 }).notNull().unique(),

    /** Human-readable label shown in the UI e.g. "QuickBooks Online" */
    displayName: varchar('display_name', { length: 255 }).notNull(),

    /** Short description of what the piece does */
    description: text('description'),

    /** Categories for filtering in the UI (e.g. ['CRM', 'Marketing']) */
    categories: jsonb('categories').$type<string[]>(),

    /** The type of authentication used (e.g. 'OAUTH2', 'BASIC', 'API_KEY') */
    authType: varchar('auth_type', { length: 100 }),

    /** The UI schema defining the authentication fields/props needed */
    authSchema: jsonb('auth_schema').$type<Record<string, unknown>>(),

    /** Aliases or specialized profiles for this piece */
    aliases: jsonb('aliases').$type<Record<string, unknown>[]>(),

    /** CDN URL of the piece's logo for the connection selector UI */
    logoUrl: varchar('logo_url', { length: 1024 }),

    /** npm package name e.g. "@soopa/piece-quickbooks" */
    packageName: varchar('package_name', { length: 255 }).notNull(),

    /** Semver string — informational, actual binary is determined by installed package */
    version: varchar('version', { length: 50 }).notNull(),

    /** Global enable/disable flag. Disabled pieces are not loaded at startup. */
    enabled: boolean('enabled').notNull().default(true),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),

    /** Last modification time — set on INSERT via defaultNow(), advanced automatically on UPDATE via $onUpdate. */
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull().$onUpdate(() => new Date()),
});
