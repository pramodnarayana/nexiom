import { pgTable, uuid, varchar, text, timestamp, jsonb, index, uniqueIndex, pgEnum } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
// NOTE: No cross-DB FK to organization — tenant isolation is enforced by TenantDatabaseManager
// routing: every request resolves tenantId from auth context and connects to the correct tenant DB.

// Shared environment discriminator — used by both app_connection and ui_workspace.
// Defined here (tenant.ts) so workspace.ts can import it without a circular dep.
export const envTypeEnum = pgEnum('env_type_enum', ['PRODUCTION', 'SANDBOX']);

// Auth type enum — matches Activepieces' AppConnectionType pattern
export const authTypeEnum = pgEnum('auth_type_enum', ['OAUTH2', 'API_KEY', 'BASIC']);

export const connectionStatusEnum = pgEnum('connection_status_enum', ['ACTIVE', 'INACTIVE', 'REVOKED', 'EXPIRED', 'PROVISIONING', 'FAILED']);

export const AppConnectionStatus = {
    ACTIVE: 'ACTIVE',
    INACTIVE: 'INACTIVE',
    EXPIRED: 'EXPIRED',
    REVOKED: 'REVOKED',
    PROVISIONING: 'PROVISIONING',
    FAILED: 'FAILED',
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
export const appConnections = pgTable('app_connection', {
    id: uuid('id').defaultRandom().primaryKey(),
    // tenantId identifies which organization this connection belongs to.
    // No FK to organization — cross-database FKs are not supported in Postgres.
    // Tenant isolation is enforced by TenantDatabaseManager: each org routes to its own DB.
    tenantId: text('tenant_id').notNull(),

    // Provider name — validated against PROVIDER_REGISTRY in application code
    appName: varchar('app_name', { length: 100 }).notNull(),

    // User-defined machine-readable identifier — unique per tenant.
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

    // Mirrors the workspace env_type — enforces that sandbox connections can only be
    // assigned to sandbox workspaces and production connections to production workspaces.
    envType: envTypeEnum('env_type').notNull().default('PRODUCTION'),

    // Plain-text metadata for display purposes only (e.g. connected account email, env label)
    metadata: jsonb('metadata').default({}),

    // Which DBManager SchemaPlan was last applied to this connection's schema
    schemaPlan: varchar('schema_plan', { length: 64 }).notNull().default('NAMESPACE_ONLY'),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull().$onUpdate(() => new Date()),
}, (table) => [
    index('app_name_idx').on(table.appName),
    index('tenant_status_idx').on(table.tenantId, table.status),
    // TokenRefreshService scans for soon-expiring tokens — partial index on non-NULL
    // expiresAt only (API_KEY connections have NULL expiresAt and are never refreshed,
    // so they'd otherwise bloat a full index for no benefit).
    index('connection_expires_at_idx').on(table.expiresAt).where(sql`${table.expiresAt} IS NOT NULL`),
    // One named connection per tenant — the externalId is the unique discriminator
    uniqueIndex('tenant_external_id_unique_idx').on(table.tenantId, table.externalId),
    // Ensure displayNames are unique per provider per tenant, ignoring case
    uniqueIndex('tenant_app_display_name_lower_idx').on(table.tenantId, table.appName, sql`lower(${table.displayName})`),
]);

/**
 * Safe column projection for appConnections queries.
 * The `value` column (encrypted credentials blob) is intentionally excluded —
 * it must never leave the ConnectorsService that owns encryption/decryption.
 * Use this with `.select(safeAppConnectionColumns).from(appConnections)` instead
 * of `db.query.appConnections.findMany()` which returns all columns.
 */
export const safeAppConnectionColumns = {
    id: appConnections.id,
    tenantId: appConnections.tenantId,
    appName: appConnections.appName,
    externalId: appConnections.externalId,
    displayName: appConnections.displayName,
    authType: appConnections.authType,
    envType: appConnections.envType,
    status: appConnections.status,
    expiresAt: appConnections.expiresAt,
    metadata: appConnections.metadata,
    schemaPlan: appConnections.schemaPlan,
    createdAt: appConnections.createdAt,
    updatedAt: appConnections.updatedAt,
} as const;