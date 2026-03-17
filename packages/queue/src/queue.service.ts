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
    if (this.consumers.has(queueName)) {
      this.logger.warn(
        `Consumer already running for ${queueName} — ignoring duplicate call`,
      );
      return;
    }

    const handle: ConsumerHandle = { running: true, inFlight: new Set() };
    this.consumers.set(queueName, handle);

    void this.poll(queueName, handler, handle, options);
  }

  async stopConsuming(): Promise<void> {
    for (const handle of this.consumers.values()) {
      handle.running = false;
    }

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
    const maxConcurrent = options?.maxConcurrent ?? 1;
    const waitTimeSeconds = options?.waitTimeSeconds ?? 20;
    const url = this.queueUrl(queueName);

    while (handle.running) {
      // Back-pressure — wait until a concurrency slot is free
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
