import { Injectable, Inject, Logger, OnModuleDestroy } from "@nestjs/common";
import {
  SQSClient,
  SendMessageCommand,
  ReceiveMessageCommand,
  DeleteMessageCommand,
} from "@aws-sdk/client-sqs";
import type {
  IQueueService,
  ConsumeOptions,
  SendOptions,
} from "./interfaces/queue-service.interface.js";
import { QueueName, QUEUE_MODULE_OPTIONS } from "./constants.js";
import type { QueueModuleOptions } from "./queue.module.js";

interface ConsumerHandle {
  running: boolean;
  inFlight: Set<Promise<void>>;
  /** Resolves when the poll loop exits — used by stopConsuming() to drain cleanly. */
  pollerPromise: Promise<void>;
}

@Injectable()
export class QueueService implements IQueueService, OnModuleDestroy {
  private readonly logger = new Logger(QueueService.name);
  private readonly client: SQSClient;
  private readonly consumers = new Map<QueueName, ConsumerHandle>();

  constructor(
    @Inject(QUEUE_MODULE_OPTIONS) private readonly options: QueueModuleOptions,
  ) {
    const isLocal = options.infraMode === "local";
    this.client = new SQSClient({
      region: options.region ?? "us-east-1",
      ...(isLocal && {
        endpoint: options.endpoint ?? "http://localhost:4566",
        credentials: { accessKeyId: "test", secretAccessKey: "test" },
      }),
    });
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  async send(
    queueName: QueueName,
    payload: unknown,
    options?: SendOptions,
  ): Promise<void> {
    if (this.options.enabled === false) {
      this.logger.debug(`Queue disabled — dropping send to ${queueName}`);
      return;
    }
    await this.client.send(
      new SendMessageCommand({
        QueueUrl: this.queueUrl(queueName),
        MessageBody: JSON.stringify(payload),
        ...(options?.delaySeconds !== undefined && {
          DelaySeconds: options.delaySeconds,
        }),
      }),
    );
    this.logger.debug(`Sent to ${queueName}`);
  }

  consume(
    queueName: QueueName,
    handler: (payload: unknown) => Promise<void>,
    options?: ConsumeOptions,
  ): void {
    if (this.options.enabled === false) {
      this.logger.debug(
        `Queue consumption disabled — skipping consumer for ${queueName}`,
      );
      return;
    }

    if (this.consumers.has(queueName)) {
      this.logger.warn(
        `Consumer already running for ${queueName} — ignoring duplicate call`,
      );
      return;
    }

    const handle: ConsumerHandle = {
      running: true,
      inFlight: new Set(),
      pollerPromise: Promise.resolve(),
    };
    this.consumers.set(queueName, handle);

    // Attach rejection handler so a startup failure (e.g. invalid options or
    // queueUrl() throwing) removes the stale entry rather than leaving an
    // orphaned consumer in the map.
    handle.pollerPromise = this.poll(queueName, handler, handle, options).catch(
      (err: unknown) => {
        this.logger.error(`Consumer for ${queueName} exited with error`, err);
        this.consumers.delete(queueName);
      },
    );
  }

  async stopConsuming(): Promise<void> {
    // 1. Signal all poll loops to exit after their current receive completes.
    for (const handle of this.consumers.values()) {
      handle.running = false;
    }

    // 2. Await every poller loop — guarantees no new processMessage() calls
    //    are scheduled after this point.
    await Promise.allSettled(
      Array.from(this.consumers.values()).map((h) => h.pollerPromise),
    );

    // 3. Await any handlers that were already in-flight when the loops exited.
    const allInFlight = Array.from(this.consumers.values()).flatMap((h) =>
      Array.from(h.inFlight),
    );
    await Promise.allSettled(allInFlight);

    this.consumers.clear();
    this.logger.log("All consumers stopped");
  }

  async onModuleDestroy(): Promise<void> {
    await this.stopConsuming();
    this.client.destroy();
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private async poll(
    queueName: QueueName,
    handler: (payload: unknown) => Promise<void>,
    handle: ConsumerHandle,
    options?: ConsumeOptions,
  ): Promise<void> {
    const raw = options?.maxConcurrent ?? 1;
    const maxConcurrent = Math.floor(raw);
    if (!Number.isFinite(maxConcurrent) || maxConcurrent <= 0) {
      throw new Error(
        `QueueService: maxConcurrent must be a positive integer, got ${raw}`,
      );
    }

    const waitTimeSeconds = options?.waitTimeSeconds ?? 20;
    const url = this.queueUrl(queueName);

    while (handle.running) {
      // Back-pressure — wait until a concurrency slot is free.
      while (handle.inFlight.size >= maxConcurrent) {
        await new Promise<void>((r) => setTimeout(r, 50));
        if (!handle.running) return;
      }

      try {
        const { Messages = [] } = await this.client.send(
          new ReceiveMessageCommand({
            QueueUrl: url,
            MaxNumberOfMessages: Math.min(
              maxConcurrent - handle.inFlight.size,
              10,
            ),
            WaitTimeSeconds: waitTimeSeconds,
          }),
        );

        // Re-check after the long-poll wait — stopConsuming() may have fired.
        if (!handle.running) return;

        for (const msg of Messages) {
          const task = this.processMessage(url, msg, handler, queueName);
          handle.inFlight.add(task);
          void task.finally(() => handle.inFlight.delete(task));
        }
      } catch (err) {
        if (handle.running) {
          this.logger.error(`Poll error on ${queueName} — backing off 2s`, err);
          await new Promise<void>((r) => setTimeout(r, 2_000));
        }
      }
    }
  }

  private async processMessage(
    url: string,
    msg: { Body?: string; ReceiptHandle?: string },
    handler: (payload: unknown) => Promise<void>,
    queueName: QueueName,
  ): Promise<void> {
    try {
      const payload: unknown = JSON.parse(msg.Body ?? "{}");
      await handler(payload);
      await this.client.send(
        new DeleteMessageCommand({
          QueueUrl: url,
          ReceiptHandle: msg.ReceiptHandle!,
        }),
      );
    } catch (err) {
      // On handler failure, do NOT delete — message returns to queue after
      // visibility timeout and will be retried up to maxReceiveCount before DLQ.
      this.logger.error(`Handler failed for message from ${queueName}`, err);
    }
  }

  private queueUrl(queueName: QueueName): string {
    const {
      infraMode,
      region = "us-east-1",
      endpoint,
      accountId,
    } = this.options;
    if (infraMode === "local") {
      const base = endpoint ?? "http://localhost:4566";
      // LocalStack always uses account ID 000000000000
      return `${base}/000000000000/${queueName}`;
    }
    // Production: requires accountId (from SSM / env). Fail fast if missing.
    if (!accountId) {
      throw new Error(
        `QueueService: accountId is required when infraMode = 'production'. ` +
          `Set AWS_ACCOUNT_ID in your environment and pass it via QueueModuleOptions.`,
      );
    }
    return `https://sqs.${region}.amazonaws.com/${accountId}/${queueName}`;
  }
}
