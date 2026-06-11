import { QueueName } from "@soopa/queue";

export interface QueuePublisherPort {
  send(queueName: QueueName, payload: unknown): Promise<void>;
}
