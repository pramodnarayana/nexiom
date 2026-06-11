/* eslint-disable @typescript-eslint/require-await */
import type { QueueName } from "@soopa/queue";
import type { QueuePublisherPort } from "../ports/outbound/queue-publisher.port.js";

export class FakeQueuePublisher implements QueuePublisherPort {
  public messages: { queueName: QueueName; payload: unknown }[] = [];
  public shouldFail = false;
  public failOnce = false;

  async send(queueName: QueueName, payload: unknown): Promise<void> {
    if (this.shouldFail) {
      throw new Error("Queue down");
    }
    if (this.failOnce) {
      this.failOnce = false;
      throw new Error("Temporary queue failure");
    }
    this.messages.push({ queueName, payload });
  }
}
