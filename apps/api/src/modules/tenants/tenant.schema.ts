import { pgTable, text, timestamp, pgEnum } from 'drizzle-orm/pg-core';
import { user } from '../auth/auth.schema';

export const organizationStatusEnum = pgEnum('organization_status', [
  'active',
  'disabled',
  'suspended',
]);

export const organization = pgTable('organization', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').unique(),
  logo: text('logo'),
  createdAt: timestamp('createdAt').notNull(),
  metadata: text('metadata'),
  status: organizationStatusEnum('status').default('active').notNull(),
});

export const member = pgTable('member', {
  id: text('id').primaryKey(),
  organizationId: text('organizationId')
    .notNull()
    .references(() => organization.id),
  userId: text('userId')
    .notNull()
    .references(() => user.id, { onDelete: 'restrict' }),
  role: text('role').notNull(),
  createdAt: timestamp('createdAt').notNull(),
});

export type Organization = typeof organization.$inferSelect;
export type Member = typeof member.$inferSelect;
