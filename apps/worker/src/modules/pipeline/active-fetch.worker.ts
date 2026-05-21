import {
  Injectable,
  Inject,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from "@nestjs/common";
import { eq } from "drizzle-orm";
import { QueueService, QueueName } from "@nexiom/queue";
import {
  DATABASE_CONNECTION,
  dataSources,
  type DrizzleDb,
} from "@nexiom/database";
import { PipelineHookBrokerService } from "@nexiom/engine";
import {
  sanitizeError,
  isValidPipelineMessage,
} from "../../shared/pipeline.utils.js";

@Injectable()
export class ActiveFetchWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ActiveFetchWorker.name);

  constructor(
    private readonly queueService: QueueService,
    @Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb,
    private readonly hookBroker: PipelineHookBrokerService,
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

    this.logger.debug(
      {
        event: "active_fetch.started",
        traceId,
        dataSourceId,
        count: missingDependencies.length,
      },
      "ActiveFetchWorker started",
    );

    try {
      // Select all columns to avoid Vitest ESM resolution TypeError on dataSources keys
      const connRows = await this.db
        .select()
        .from(dataSources)
        .where(eq(dataSources.id, dataSourceId))
        .limit(1);

      if (!connRows[0]) {
        throw new Error(
          `Connection ${dataSourceId} not found in app_connection`,
        );
      }

      const connectionAppName = connRows[0].appName;
      const metadata = connRows[0].metadata as Record<string, unknown> | null;

      const trimmedAppProfile =
        typeof metadata?.appProfile === "string"
          ? metadata.appProfile.trim()
          : "";
      const appProfile =
        trimmedAppProfile !== "" ? trimmedAppProfile : "standard";

      await this.hookBroker.activeFetch(
        connectionAppName,
        appProfile,
        missingDependencies,
        dataSourceId,
      );

      this.logger.log(
        { event: "active_fetch.completed", traceId, dataSourceId },
        "ActiveFetchWorker completed successfully",
      );
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
