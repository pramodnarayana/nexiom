/* eslint-disable @typescript-eslint/require-await */
import type {
  ChatStreamOrchestratorPort,
  RealtimeEventPubSubPort,
  ChatPersistencePort,
  TitleGeneratorPort,
  ChatMessage,
} from "../ports/outbound/copilot-ports.js";

export class FakeChatStreamOrchestrator implements ChatStreamOrchestratorPort {
  public chunksToYield: string[] = [];
  public shouldFail = false;

  async streamChat(
    _messages: ChatMessage[],
    _tenantId: string,
    _traceId: string,
    _model?: string,
  ): Promise<AsyncIterable<string>> {
    if (this.shouldFail) {
      throw new Error("Orchestration failed");
    }

    // Create a simple async generator
    const chunks = this.chunksToYield;
    return (async function* () {
      for (const chunk of chunks) {
        yield chunk;
      }
    })();
  }
}

export class FakeRealtimeEventPubSub implements RealtimeEventPubSubPort {
  public parts: { jobId: string; chunk: string }[] = [];
  public errors: { jobId: string; errorMessage: string }[] = [];
  public dones: string[] = [];

  async publishStreamPart(jobId: string, chunk: string): Promise<void> {
    this.parts.push({ jobId, chunk });
  }

  async publishError(jobId: string, errorMessage: string): Promise<void> {
    this.errors.push({ jobId, errorMessage });
  }

  async publishDone(jobId: string): Promise<void> {
    this.dones.push(jobId);
    return Promise.resolve();
  }

  async publishSystemEvent(_event: string, _payload: unknown): Promise<void> {
    return Promise.resolve();
  }
}

export class FakeChatPersistence implements ChatPersistencePort {
  public appendedMessages: {
    tenantId: string;
    conversationId: string;
    role: "assistant" | "system";
    content: string;
    status: "completed" | "failed";
  }[] = [];

  public titles: { tenantId: string; conversationId: string; title: string }[] =
    [];

  async appendMessage(params: {
    tenantId: string;
    conversationId: string;
    role: "assistant" | "system";
    content: string;
    status: "completed" | "failed";
  }): Promise<void> {
    this.appendedMessages.push(params);
  }

  async updateConversationTitle(
    tenantId: string,
    conversationId: string,
    title: string,
  ): Promise<void> {
    this.titles.push({ tenantId, conversationId, title });
  }
}

export class FakeTitleGenerator implements TitleGeneratorPort {
  public nextTitle = "A fake title";

  async generateTitle(_firstMessage: string): Promise<string> {
    return this.nextTitle;
  }
}
