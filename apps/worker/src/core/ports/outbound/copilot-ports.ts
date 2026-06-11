export type ChatRole = "user" | "assistant" | "system";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ChatStreamOrchestratorPort {
  /**
   * Returns an AsyncIterable representing the stream of Vercel AI SDK text parts.
   * Throws if the orchestration fails to start.
   */
  streamChat(
    messages: ChatMessage[],
    tenantId: string,
    traceId: string,
    model?: string,
  ): Promise<AsyncIterable<string>>;
}

export interface RealtimeEventPubSubPort {
  publishStreamPart(jobId: string, chunk: string): Promise<void>;
  publishError(jobId: string, errorMessage: string): Promise<void>;
  publishDone(jobId: string): Promise<void>;
}

export interface ChatPersistencePort {
  appendMessage(params: {
    tenantId: string;
    conversationId: string;
    role: "assistant" | "system";
    content: string;
    status: "completed" | "failed";
  }): Promise<void>;

  updateConversationTitle(
    tenantId: string,
    conversationId: string,
    title: string,
  ): Promise<void>;
}

export interface TitleGeneratorPort {
  generateTitle(firstMessage: string): Promise<string>;
}
