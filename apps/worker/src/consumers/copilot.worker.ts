import { Injectable, OnModuleInit, Logger, Inject } from "@nestjs/common";
import { QUEUE_SERVICE, QueueName } from "@soopa/queue";
import type { IQueueService } from "@soopa/queue";
import { OrchestratorService, ChatPersistenceService } from "@soopa/ai";
import { generateText } from "ai";
import { google } from "@ai-sdk/google";
import type { Redis } from "ioredis";
import { z } from "zod";

const JobPayloadSchema = z.object({
  jobId: z.string(),
  traceId: z.string(),
  tenantId: z.string(),
  conversationId: z.string(),
  messages: z.array(
    z.object({
      role: z.string(),
      content: z.string(),
    }),
  ),
  model: z.string().optional(),
});

@Injectable()
export class CopilotWorker implements OnModuleInit {
  private readonly logger = new Logger(CopilotWorker.name);

  constructor(
    @Inject(QUEUE_SERVICE) private readonly queueService: IQueueService,
    @Inject("REDIS_CLIENT") private readonly redis: Redis,
    private readonly orchestrator: OrchestratorService,
    private readonly chatPersistence: ChatPersistenceService,
  ) {}

  onModuleInit() {
    this.logger.log("Starting CopilotWorker to consume AiCopilotQueue...");
    this.queueService.consume(
      QueueName.AiCopilotQueue,
      this.handleMessage.bind(this),
      { maxConcurrent: 5, waitTimeSeconds: 20 },
    );
  }

  private async handleMessage(payload: unknown): Promise<void> {
    try {
      const validationResult = JobPayloadSchema.safeParse(payload);

      if (!validationResult.success) {
        const safeMetadata = {
          jobId:
            typeof payload === "object" &&
            payload !== null &&
            "jobId" in payload
              ? payload.jobId
              : undefined,
          validationError: validationResult.error,
        };
        this.logger.error(
          safeMetadata,
          "Invalid job payload received - rejecting message",
        );
        throw new Error(
          `Invalid job payload: ${validationResult.error.message}`,
        );
      }

      const data = validationResult.data;

      this.logger.debug(
        `Processing AI Job ${data.jobId} for conversation ${data.conversationId}`,
      );

      // Async Title Generation for New Conversations
      if (data.messages.length === 1 && data.messages[0].role === "user") {
        const firstMessage = data.messages[0].content;
        // Fire and forget title generation in background

        generateText({
          model: google("gemini-1.5-flash"),
          system:
            "You are an expert copywriter. Summarize the user's intent into a 3-5 word clean title. Do not include quotes, periods, or extra text. Capitalize it like a Title.",
          prompt: firstMessage,
        })
          .then(async (res) => {
            const newTitle = res.text.trim();
            this.logger.debug(
              `Generated title for ${data.conversationId}: ${newTitle}`,
            );
            return this.chatPersistence.updateConversationTitle(
              data.tenantId,
              data.conversationId,
              newTitle,
            );
          })
          .catch((err) => {
            this.logger.error("Failed to generate title", err);
          });
      }

      // We use the orchestrator to process the chat synchronously from the worker's perspective
      // To satisfy UIMessage[] parameter requirements, we ensure it conforms
      const webResponse = await this.orchestrator.streamChat(
        data.messages as unknown as Parameters<
          typeof this.orchestrator.streamChat
        >[0],
        data.tenantId,
        data.traceId,
        data.model,
      );

      // We read the entire response stream directly in the worker
      // This forces the Vercel AI SDK to iterate completely and fire all `onFinish` handlers,
      // saving tool invocations and final responses securely to the database.
      if (webResponse.body) {
        // Check for non-OK response
        if (!webResponse.ok) {
          const errorText = await webResponse.text();
          throw new Error(`Non-OK response from orchestrator: ${errorText}`);
        }

        // Read stream to exhaustion
        const reader = webResponse.body.getReader();
        const decoder = new TextDecoder("utf-8", { fatal: false });
        let finalResponseBuilder = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          // Process streams here for SSE broadcast (Step 4)
          // `value` is a Uint8Array containing Vercel Stream Parts.
          if (value) {
            const decodedChunk = decoder.decode(value, { stream: true });
            finalResponseBuilder += decodedChunk;
            // Publish standard Vercel Stream Parts out to SSE bridge
            await this.redis.publish(`job:stream:${data.jobId}`, decodedChunk);
          }
        }

        // Flush any remaining bytes from the decoder
        const finalChunk = decoder.decode();
        if (finalChunk) {
          finalResponseBuilder += finalChunk;
        }

        // Publish termination marker for SSE Client
        await this.redis.publish(`job:stream:${data.jobId}`, `[DONE]\n`);

        this.logger.debug(
          `Stream fully consumed. Payload length: ${finalResponseBuilder.length}`,
        );

        // Reconstruct human-readable response and step metadata for persistent storage
        let humanResponse = "";
        const stepMetadata: Record<string, unknown>[] = [];
        const lines = finalResponseBuilder.split("\n");
        for (const line of lines) {
          if (line.trim().startsWith("0:")) {
            try {
              humanResponse += JSON.parse(line.trim().substring(2));
            } catch {
              // Ignore partial parsing errors
            }
          } else if (line.trim().startsWith("8:")) {
            try {
              const stepData = JSON.parse(line.trim().substring(2)) as Record<
                string,
                unknown
              >;
              stepMetadata.push(stepData);
            } catch {
              // Ignore partial parsing errors
            }
          }
        }

        if (humanResponse.trim()) {
          await this.chatPersistence.appendMessage({
            tenantId: data.tenantId,
            conversationId: data.conversationId,
            role: "assistant",
            content: humanResponse.trim(),
            status: "completed",
          });
        }

        // Persist step metadata alongside the final response if any steps were captured
        if (stepMetadata.length > 0) {
          this.logger.debug(
            `Captured ${stepMetadata.length} step metadata entries for conversation ${data.conversationId}`,
          );
          // Store step metadata in the same persistence layer
          // Note: This could be stored as a system message or in a dedicated step metadata table
          await this.chatPersistence.appendMessage({
            tenantId: data.tenantId,
            conversationId: data.conversationId,
            role: "system",
            content: JSON.stringify({ steps: stepMetadata }),
            status: "completed",
          });
        }

        this.logger.log(`Successfully completed AI Job ${data.jobId}`);
      } else {
        const errorMsg = "Response body is missing from orchestrator";
        await this.redis.publish(
          `job:stream:${data.jobId}`,
          `error: ${errorMsg}\n`,
        );
        await this.redis.publish(`job:stream:${data.jobId}`, `[DONE]\n`);
        await this.chatPersistence.appendMessage({
          tenantId: data.tenantId,
          conversationId: data.conversationId,
          role: "system",
          content: errorMsg,
          status: "failed",
        });
        throw new Error(errorMsg);
      }
    } catch (error) {
      // Publish failure marker to Redis before throwing
      const jobId =
        typeof payload === "object" && payload !== null && "jobId" in payload
          ? String((payload as Record<string, unknown>).jobId)
          : "unknown";
      await this.redis.publish(
        `job:stream:${jobId}`,
        `error: ${(error as Error).message}\n`,
      );
      await this.redis.publish(`job:stream:${jobId}`, `[DONE]\n`);
      this.logger.error("Failed to process Copilot Job", error);
      throw error; // Let SQS push it to DLQ after MaxReceiveCount
    }
  }
}
