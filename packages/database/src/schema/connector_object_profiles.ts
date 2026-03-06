import { jsonb, pgTable, timestamp, varchar, primaryKey } from 'drizzle-orm/pg-core';

export const connectorObjectProfiles = pgTable('connector_object_profiles', {
    appName: varchar('app_name', { length: 100 }).notNull(),
    objectName: varchar('object_name', { length: 100 }).notNull(),
    profile: jsonb('profile').notNull().default('{}'),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => [
    primaryKey({ columns: [table.appName, table.objectName] })
]);
