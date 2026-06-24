import {
    pgTable,
    uuid,
    varchar,
    text,
    timestamp,
    primaryKey,
    index,
    uniqueIndex,
    unique,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';
import { envTypeEnum } from '../global/routing.js';
export { envTypeEnum } from '../global/routing.js';
// NOTE: No cross-DB FK to organization — tenant isolation enforced by TenantDatabaseManager routing.

// ---------------------------------------------------------------------------

/**
 * UI WORKSPACES
 *
 * Logical folders that group connections and integrations for a team.
 * Each workspace is tagged as PRODUCTION or SANDBOX, which controls
 * which physical DB cluster the Storage Registry routes writes to.
 *
 * One org can have many workspaces (e.g. "Logistics-US", "Logistics-CA").
 */
export const uiWorkspaces = pgTable('ui_workspace', {
    id: uuid('id').defaultRandom().primaryKey(),
    // orgId identifies the owning organization. No cross-DB FK to organization table.
    orgId: text('org_id').notNull(),
    name: varchar('name', { length: 255 }).notNull(),
    envType: envTypeEnum('env_type').notNull().default('PRODUCTION'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull().$onUpdate(() => new Date()),
}, (table) => [
    // Case-insensitive uniqueness per env — same name allowed in PRODUCTION vs SANDBOX
    uniqueIndex('ui_ws_org_name_lower_unique_idx').on(table.orgId, table.envType, sql`lower(${table.name})`),
    // Composite unique on (id, orgId) — required target for the composite FK
    // in integration_stitch that enforces workspace ↔ org co-ownership.
    unique('ui_ws_id_org_unique_idx').on(table.id, table.orgId),
    index('ui_ws_org_idx').on(table.orgId),
    index('ui_ws_env_idx').on(table.orgId, table.envType),
]);
