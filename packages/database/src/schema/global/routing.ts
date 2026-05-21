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
