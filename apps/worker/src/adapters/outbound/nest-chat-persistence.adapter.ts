import { Injectable } from "@nestjs/common";
import { ChatPersistenceService } from "@soopa/ai";
import type { ChatPersistencePort } from "../../core/ports/outbound/copilot-ports.js";

@Injectable()
export class NestChatPersistenceAdapter implements ChatPersistencePort {
  constructor(private readonly persistenceService: ChatPersistenceService) {}

  async appendMessage(params: {
    tenantId: string;
    conversationId: string;
    role: "assistant" | "system";
    content: string;
    status: "completed" | "failed";
  }): Promise<void> {
    await this.persistenceService.appendMessage(params);
  }

  async updateConversationTitle(
    tenantId: string,
    conversationId: string,
    title: string,
  ): Promise<void> {
    await this.persistenceService.updateConversationTitle(
      tenantId,
      conversationId,
      title,
    );
  }
}
