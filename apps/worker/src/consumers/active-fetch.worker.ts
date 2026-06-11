import { sanitizeError, isValidPipelineMessage } from "@soopa/pipeline";
import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from "@nestjs/common";
import { QueueService, QueueName } from "@soopa/queue";
import { ProcessActiveFetchUseCase } from "../core/use-cases/active-fetch/process-active-fetch.use-case.js";
import { DrizzleDataSourceRepositoryAdapter } from "../adapters/outbound/drizzle-data-source.repository.js";
import { NestPipelineHookBrokerAdapter } from "../adapters/outbound/nest-pipeline-hook-broker.adapter.js";

@Injectable()
export class ActiveFetchWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ActiveFetchWorker.name);

  constructor(
    private readonly queueService: QueueService,
    private readonly dataSourceRepository: DrizzleDataSourceRepositoryAdapter,
    private readonly hookBrokerAdapter: NestPipelineHookBrokerAdapter,
  ) {}

  onModuleInit() {
    this.queueService.consume(QueueName.ActiveFetchQueue, async (msg) => {
      await this.processMessage(msg);
    });
  }

  onModuleDestroy() {}

  private async processMessage(rawMsg: unknown): Promise<void> {
    const msg = rawMsg as Record<string, unknown>;

    if (!isValidPipelineMessage(msg, ["traceId", "dataSourceId"])) {
      this.logger.warn(
        {
          event: "active_fetch.invalid_message",
          msg: JSON.stringify(msg).slice(0, 200),
        },
        "ActiveFetchWorker: dropping invalid message",
      );
      return;
    }

    const traceId = msg.traceId as string;
    const dataSourceId = msg.dataSourceId as string;
    const missingDependencies = msg.missingDependencies as Array<{
      entityType: string;
      sourceId: string;
    }>;

    if (!Array.isArray(missingDependencies)) {
      this.logger.warn(
        {
          event: "active_fetch.invalid_message",
          msg: JSON.stringify(msg).slice(0, 200),
        },
        "ActiveFetchWorker: missingDependencies is not an array",
      );
      return;
    }

    try {
      const useCase = new ProcessActiveFetchUseCase(
        this.dataSourceRepository,
        this.hookBrokerAdapter,
      );
      await useCase.execute(traceId, dataSourceId, missingDependencies);
    } catch (err) {
      this.logger.error(
        {
          event: "active_fetch.error",
          traceId,
          dataSourceId,
          err: sanitizeError(err),
        },
        "ActiveFetchWorker failed",
      );
      throw err;
    }
  }
}
