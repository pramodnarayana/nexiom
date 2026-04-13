import { pgTable, uuid, varchar, text, timestamp, index, primaryKey } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { organization } from './identity.js';

/**
 * Storage for ChatGPT-style conversational grouping.
 */
export const aiConversations = pgTable('ai_conversations', {
    id: uuid('id').defaultRandom().notNull(),
    tenantId: text('tenant_id').notNull(),
    title: varchar('title', { length: 255 }).notNull().default('New Conversation'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull().$onUpdate(() => new Date()),
}, (table) => {
    return {
        // Enforce composite primary key for true multi-tenant partitioning
        pk: primaryKey({ columns: [table.tenantId, table.id] }),
        tenantIdx: index('ai_conv_tenant_idx').on(table.tenantId),
        createdIdx: index('ai_conv_created_idx').on(table.createdAt)
    };
});

/**
 * Storage for individual text utterances sent to/from the AI Planner.
 */
export const aiMessages = pgTable('ai_messages', {
    id: uuid('id').defaultRandom().notNull(),
    tenantId: text('tenant_id').notNull(),
    conversationId: uuid('conversation_id').notNull(),
    role: varchar('role', { length: 50 }).notNull(), // 'user' | 'assistant' | 'system'
    content: text('content').notNull(),
    status: varchar('status', { length: 50 }).notNull().default('completed'), // 'pending' | 'completed' | 'failed'
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => {
    return {
        // Enforce composite primary key for true multi-tenant partitioning
        pk: primaryKey({ columns: [table.tenantId, table.id] }),
        convIdx: index('ai_msg_conv_idx').on(table.conversationId),
        tenantIdx: index('ai_msg_tenant_idx').on(table.tenantId),
        timelineIdx: index('ai_msg_timeline_idx').on(table.conversationId, table.createdAt)
    };
});

// Relationships
export const aiConversationsRelations = relations(aiConversations, ({ one, many }) => ({
    tenant: one(organization, {
        fields: [aiConversations.tenantId],
        references: [organization.id],
    }),
    messages: many(aiMessages),
}));

export const aiMessagesRelations = relations(aiMessages, ({ one }) => ({
    tenant: one(organization, {
        fields: [aiMessages.tenantId],
        references: [organization.id],
    }),
    conversation: one(aiConversations, {
        // Must match the composite PK
        fields: [aiMessages.tenantId, aiMessages.conversationId],
        references: [aiConversations.tenantId, aiConversations.id],
    }),
}));
