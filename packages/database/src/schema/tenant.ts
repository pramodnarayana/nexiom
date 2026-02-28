import { pgTable, uuid, varchar, text, timestamp, jsonb, index, uniqueIndex, pgEnum } from 'drizzle-orm/pg-core';

// Auth type enum — matches Activepieces' AppConnectionType pattern
export const authTypeEnum = pgEnum('auth_type_enum', ['OAUTH2', 'API_KEY', 'BASIC']);

// Tenants table — cross-database FKs handled in raw SQL migrations (0000_...sql)
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

/**
 * Activepieces-style single-table connection.
 *
 * One row = one named connection. A tenant can have multiple connections to
 * the same provider (e.g. "TMS Salesforce" + "Marketing Salesforce"), each
 * identified by a user-provided externalId (kebab slug).
 *
 * Encrypted `value` blob contains everything sensitive:
 *   { clientId, clientSecret, accessToken, refreshToken, data }
 * where `data` holds vendor-specific extras (instance_url, realmId, etc.)
 */
export const workspaces = pgTable("workspace", {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    slug: varchar("slug", { length: 255 }).notNull(),
    dbSchemaName: varchar("db_schema_name", { length: 255 }).notNull().unique(), // e.g. tenant_ws_101
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull().$onUpdate(() => new Date()),
}, (table) => [
    index("workspace_tenant_idx").on(table.tenantId),
    uniqueIndex("workspace_tenant_slug_idx").on(table.tenantId, table.slug),
]);

export const appConnections = pgTable('app_connection', {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id').notNull(),

    // Provider name — validated against PROVIDER_REGISTRY in application code
    appName: varchar('app_name', { length: 100 }).notNull(),

    // User-defined machine-readable identifier — unique per workspace.
    // Auto-generated as kebab-case from displayName on the frontend
    // e.g. "TMS Salesforce" → "tms-salesforce"
    externalId: varchar('external_id', { length: 255 }).notNull(),

    // Human-readable label shown in the UI e.g. "TMS Salesforce"
    displayName: varchar('display_name', { length: 255 }).notNull(),

    // Auth mechanism — kept as top-level for fast filtering and token refresh
    // dispatch without needing to decrypt `value`. Mirrors Activepieces' AppConnectionType.
    authType: authTypeEnum('auth_type').notNull(),

    // Encrypted payload. JSON structure:
    // { clientId, clientSecret, accessToken, refreshToken, data: Record<string, unknown> }
    // where `data` holds all vendor-specific extras (instance_url, realmId, etc.)
    value: text('value').notNull(),

    // Extracted from `value.expires_in` for fast expiry queries without decryption
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    status: connectionStatusEnum('status').default('ACTIVE').notNull(),

    // Plain-text metadata for display purposes only (e.g. connected account email, env label)
    metadata: jsonb('metadata').default({}),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull().$onUpdate(() => new Date()),
}, (table) => [
    index('app_name_idx').on(table.appName),
    index('workspace_status_idx').on(table.workspaceId, table.status),
    // One named connection per workspace — the externalId is the unique discriminator
    uniqueIndex('workspace_external_id_unique_idx').on(table.workspaceId, table.externalId),
]);