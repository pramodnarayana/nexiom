import { Injectable } from "@nestjs/common";
import { OrchestratorService } from "@soopa/ai";
import type {
  ChatStreamOrchestratorPort,
  ChatMessage,
} from "../../core/ports/outbound/copilot-ports.js";

@Injectable()
export class NestChatStreamOrchestratorAdapter implements ChatStreamOrchestratorPort {
  constructor(private readonly orchestratorService: OrchestratorService) {}

  async streamChat(
    messages: ChatMessage[],
    tenantId: string,
    traceId: string,
    model?: string,
  ): Promise<AsyncIterable<string>> {
    // Map worker ChatMessage[] to Vercel AI SDK UIMessage[] format
    const uiMessages = messages.map((msg) => ({
      role: msg.role,
      content: msg.content,
    })) as Parameters<typeof this.orchestratorService.streamChat>[0];

    const webResponse = await this.orchestratorService.streamChat(
      uiMessages,
      tenantId,
      traceId,
      model,
    );

    if (!webResponse.ok) {
      throw new Error(`Failed to stream chat: ${webResponse.statusText}`);
    }

    if (!webResponse.body) {
      throw new Error("Missing response body from streamChat");
    }

    const reader = webResponse.body.getReader();
    const decoder = new TextDecoder();

    return {
      async *[Symbol.asyncIterator]() {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            yield decoder.decode(value, { stream: true });
          }
          // Flush any incomplete multibyte sequences
          const finalChunk = decoder.decode();
          if (finalChunk) {
            yield finalChunk;
          }
        } finally {
          reader.releaseLock();
        }
      },
    };
  }
}
