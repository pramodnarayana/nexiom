import { Injectable, Logger, Inject, NotFoundException } from '@nestjs/common';
import { DATABASE_CONNECTION, aiConversations, aiMessages } from '@nexiom/database';
import { eq, and, desc } from 'drizzle-orm';
import type { DrizzleDb } from '@nexiom/database';

@Injectable()
export class ChatPersistenceService {
  private readonly logger = new Logger(ChatPersistenceService.name);

  constructor(@Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb) {}

  /**
   * Initializes or retrieves an existing conversation.
   * If a string of messages is passed initially, the title can be inferred.
   */
  async getOrCreateConversation(
    tenantId: string,
    conversationId?: string,
    initialTitle?: string
  ) {
    if (conversationId) {
      const existing = await this.db.select().from(aiConversations)
        .where(
          and(
            eq(aiConversations.id, conversationId),
            eq(aiConversations.tenantId, tenantId)
          )
        );

      if (existing.length === 0) {
        throw new NotFoundException('Conversation not found');
      }

      return existing[0];
    }

    const inserted = await this.db.insert(aiConversations).values({
      tenantId: tenantId,
      title: initialTitle || 'New Query',
    }).returning();

    return inserted[0];
  }

  /**
   * Appends an individual message to a conversational timeline.
   */
  async appendMessage({
    tenantId,
    conversationId,
    role,
    content,
    status = 'completed'
  }: {
    tenantId: string;
    conversationId: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    status?: 'pending' | 'completed' | 'failed';
  }) {
    const inserted = await this.db.insert(aiMessages).values({
      tenantId,
      conversationId,
      role,
      content,
      status,
    }).returning();

    return inserted[0];
  }

  /**
   * Fetch complete message lineage for a conversation.
   */
  async getLineage(tenantId: string, conversationId: string) {
    return this.db.select().from(aiMessages)
      .where(
        and(
          eq(aiMessages.conversationId, conversationId),
          eq(aiMessages.tenantId, tenantId)
        )
      )
      .orderBy(aiMessages.createdAt);
  }

  /**
   * Fetch all conversations for a given tenant, ordered by newest first.
   */
  async listConversations(tenantId: string) {
    return this.db.select().from(aiConversations)
      .where(eq(aiConversations.tenantId, tenantId))
      .orderBy(desc(aiConversations.createdAt));
  }

  /**
   * Update the title of a conversation.
   */
  async updateConversationTitle(tenantId: string, conversationId: string, title: string) {
    const updated = await this.db.update(aiConversations)
      .set({ title })
      .where(
        and(
          eq(aiConversations.id, conversationId),
          eq(aiConversations.tenantId, tenantId)
        )
      ).returning();

    return updated[0];
  }
}