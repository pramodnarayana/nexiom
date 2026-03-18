import type { QueueName } from "../constants.js";

export interface ConsumeOptions {
  /** Maximum number of messages to process concurrently per queue. Default: 1. */
  maxConcurrent?: number;
  /** SQS long-poll wait time in seconds. Default: 20. */
  waitTimeSeconds?: number;
}

export interface SendOptions {
  /** Delay in seconds before the message becomes visible. Default: 0. */
  delaySeconds?: number;
}

export interface IQueueService {
  /**
   * Sends a message to the specified queue.
   * The payload is JSON-serialised before sending.
   */
  send(
    queueName: QueueName,
    payload: unknown,
    options?: SendOptions,
  ): Promise<void>;

  /**
   * Starts a long-poll consumer loop for the given queue.
   * The handler is called once per message; on rejection the message
   * returns to the queue after the visibility timeout elapses.
   * Calling consume() twice for the same queue is a no-op (logs a warning).
   */
  consume(
    queueName: QueueName,
    handler: (payload: unknown) => Promise<void>,
    options?: ConsumeOptions,
  ): void;

  /**
   * Signals all active consumers to stop polling, then waits for every
   * in-flight handler to settle. Called by ShutdownService on SIGTERM.
   */
  stopConsuming(): Promise<void>;
}
