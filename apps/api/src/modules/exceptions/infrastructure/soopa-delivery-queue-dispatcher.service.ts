import { Injectable } from '@nestjs/common';
import { QueueService, QueueName } from '@soopa/queue';
import {
  IDeliveryQueueDispatcher,
  DeliveryPayload,
} from '../interfaces/delivery-queue-dispatcher.interface.js';

@Injectable()
export class SoopaDeliveryQueueDispatcherService implements IDeliveryQueueDispatcher {
  constructor(private readonly queueService: QueueService) {}

  async dispatchRetry(payload: DeliveryPayload): Promise<void> {
    await this.queueService.send(QueueName.DeliveryQueue, {
      traceId: payload.traceId,
      srcDataSourceId: payload.srcDataSourceId,
      destDataSourceId: payload.destDataSourceId,
      routeId: payload.routeId,
      hydratedPayload: payload.hydratedPayload,
    });
  }
}
