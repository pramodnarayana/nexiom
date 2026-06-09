import { pgTable, uuid, varchar, timestamp } from 'drizzle-orm/pg-core';
import { uiWorkspaces } from './workspace.js';
import { pieces } from './pieces.js';

export const workspacePieces = pgTable('workspace_pieces', {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id').notNull().references(() => uiWorkspaces.id, { onDelete: 'cascade' }),
    pieceId: uuid('piece_id').notNull().references(() => pieces.id, { onDelete: 'cascade' }),
    
    // e.g. "0.5.1"
    installedVersion: varchar('installed_version', { length: 50 }),
    
    // INSTALLING, INSTALLED, FAILED
    status: varchar('status', { length: 50 }).notNull().default('INSTALLING'),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull().$onUpdate(() => new Date()),
});
