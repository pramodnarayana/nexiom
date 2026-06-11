import { Injectable, OnModuleInit, Logger, Inject } from "@nestjs/common";
import { QUEUE_SERVICE, QueueName } from "@soopa/queue";
import type { IQueueService } from "@soopa/queue";
import { z } from "zod";

import { ProcessCopilotJobUseCase } from "../core/use-cases/copilot/process-copilot-job.use-case.js";
import { NestChatStreamOrchestratorAdapter } from "../adapters/outbound/nest-chat-stream-orchestrator.adapter.js";
import { RedisRealtimeEventPubSubAdapter } from "../adapters/outbound/redis-realtime-event-pubsub.adapter.js";
import { NestChatPersistenceAdapter } from "../adapters/outbound/nest-chat-persistence.adapter.js";
import { AiSdkTitleGeneratorAdapter } from "../adapters/outbound/ai-sdk-title-generator.adapter.js";

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
    private readonly orchestratorAdapter: NestChatStreamOrchestratorAdapter,
    private readonly pubSubAdapter: RedisRealtimeEventPubSubAdapter,
    private readonly persistenceAdapter: NestChatPersistenceAdapter,
    private readonly titleGeneratorAdapter: AiSdkTitleGeneratorAdapter,
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
    const validationResult = JobPayloadSchema.safeParse(payload);

    if (!validationResult.success) {
      const safeMetadata = {
        jobId:
          typeof payload === "object" && payload !== null && "jobId" in payload
            ? payload.jobId
            : undefined,
        validationError: validationResult.error,
      };
      this.logger.error(
        safeMetadata,
        "Invalid job payload received - rejecting message",
      );
      throw new Error(`Invalid job payload: ${validationResult.error.message}`);
    }

    const data = validationResult.data;

    const useCase = new ProcessCopilotJobUseCase(
      this.orchestratorAdapter,
      this.pubSubAdapter,
      this.persistenceAdapter,
      this.titleGeneratorAdapter,
    );

    await useCase.execute(data);
  }
}
