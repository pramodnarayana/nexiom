import { Logger } from "@nestjs/common";
import type {
  ChatStreamOrchestratorPort,
  RealtimeEventPubSubPort,
  ChatPersistencePort,
  TitleGeneratorPort,
  ChatMessage,
} from "../../ports/outbound/copilot-ports.js";

export interface ProcessCopilotJobCommand {
  jobId: string;
  traceId: string;
  tenantId: string;
  conversationId: string;
  messages: ChatMessage[];
  model?: string;
}

export class ProcessCopilotJobUseCase {
  private readonly logger = new Logger(ProcessCopilotJobUseCase.name);

  constructor(
    private readonly orchestrator: ChatStreamOrchestratorPort,
    private readonly pubSub: RealtimeEventPubSubPort,
    private readonly persistence: ChatPersistencePort,
    private readonly titleGenerator: TitleGeneratorPort,
  ) {}

  async execute(command: ProcessCopilotJobCommand): Promise<void> {
    this.logger.debug(
      `Processing AI Job ${command.jobId} for conversation ${command.conversationId}`,
    );

    // Generate title for first user message
    if (command.messages.length === 1 && command.messages[0].role === "user") {
      await this.generateAndSaveTitle(
        command.tenantId,
        command.conversationId,
        command.messages[0].content,
      );
    }

    try {
      const stream = await this.orchestrator.streamChat(
        command.messages,
        command.tenantId,
        command.traceId,
        command.model,
      );

      let finalResponseBuilder = "";

      for await (const chunk of stream) {
        finalResponseBuilder += chunk;
        await this.pubSub.publishStreamPart(command.jobId, chunk);
      }

      this.logger.debug(
        `Stream fully consumed. Payload length: ${finalResponseBuilder.length}`,
      );

      const { humanResponse, stepMetadata } =
        this.parseVercelStreamParts(finalResponseBuilder);

      if (humanResponse.trim()) {
        await this.persistence.appendMessage({
          tenantId: command.tenantId,
          conversationId: command.conversationId,
          role: "assistant",
          content: humanResponse.trim(),
          status: "completed",
        });
      }

      if (stepMetadata.length > 0) {
        this.logger.debug(
          `Captured ${stepMetadata.length} step metadata entries for conversation ${command.conversationId}`,
        );
        await this.persistence.appendMessage({
          tenantId: command.tenantId,
          conversationId: command.conversationId,
          role: "system",
          content: JSON.stringify({ steps: stepMetadata }),
          status: "completed",
        });
      }

      await this.pubSub.publishDone(command.jobId);

      this.logger.log(`Successfully completed AI Job ${command.jobId}`);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      await this.pubSub.publishError(command.jobId, errorMessage);
      await this.pubSub.publishDone(command.jobId);

      // We only append a failure system message if it was a catastrophic failure before streaming began?
      // Actually, original code appended a message if the response body was missing, but here `streamChat` throws if it fails.
      // We shouldn't necessarily append a message for every transport failure, but let's rethrow for DLQ.
      this.logger.error("Failed to process Copilot Job", error);
      throw error;
    }
  }

  private parseVercelStreamParts(rawPayload: string) {
    let humanResponse = "";
    const stepMetadata: Record<string, unknown>[] = [];
    const lines = rawPayload.split("\n");

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith("0:")) {
        try {
          humanResponse += JSON.parse(trimmed.substring(2));
        } catch {
          // Ignore
        }
      } else if (trimmed.startsWith("8:")) {
        try {
          const stepData = JSON.parse(trimmed.substring(2)) as Record<
            string,
            unknown
          >;
          stepMetadata.push(stepData);
        } catch {
          // Ignore
        }
      }
    }

    return { humanResponse, stepMetadata };
  }

  private async generateAndSaveTitle(
    tenantId: string,
    conversationId: string,
    firstMessage: string,
  ): Promise<void> {
    try {
      const newTitle = await this.titleGenerator.generateTitle(firstMessage);
      this.logger.debug(`Generated title for ${conversationId}: [REDACTED]`);
      await this.persistence.updateConversationTitle(
        tenantId,
        conversationId,
        newTitle,
      );
    } catch (err) {
      this.logger.error("Failed to generate title", err);
    }
  }
}
