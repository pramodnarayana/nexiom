import { Injectable, Inject } from "@nestjs/common";
import type { QueuePublisherPort } from "../../core/ports/outbound/queue-publisher.port.js";
import { QUEUE_SERVICE, type IQueueService, QueueName } from "@soopa/queue";

@Injectable()
export class NestQueuePublisherAdapter implements QueuePublisherPort {
  constructor(
    @Inject(QUEUE_SERVICE) private readonly queueService: IQueueService,
  ) {}

  async send(queueName: QueueName, payload: unknown): Promise<void> {
    await this.queueService.send(queueName, payload);
  }
}
