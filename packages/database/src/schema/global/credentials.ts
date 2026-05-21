import { pgTable, uuid, text, timestamp, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { authTypeEnum, connectionStatusEnum } from './routing.js';
import { dataSources } from './data-sources.js';

/**
 * Credentials tied to a Data Source.
 * Decoupled from the logical data source.
 */
export const credentials = pgTable('credential', {
    id: uuid('id').defaultRandom().primaryKey(),
    dataSourceId: uuid('data_source_id').notNull().references(() => dataSources.id, { onDelete: 'cascade' }),

    authType: authTypeEnum('auth_type').notNull(),

    // Encrypted payload. JSON structure:
    // { clientId, clientSecret, accessToken, refreshToken }
    value: text('value').notNull(),

    expiresAt: timestamp('expires_at', { withTimezone: true }),
    status: connectionStatusEnum('status').default('ACTIVE').notNull(),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull().$onUpdate(() => new Date()),
}, (table) => [
    index('cred_data_source_idx').on(table.dataSourceId),
    index('cred_status_idx').on(table.status),
    index('cred_expires_at_idx').on(table.expiresAt).where(sql`${table.expiresAt} IS NOT NULL`),
]);
