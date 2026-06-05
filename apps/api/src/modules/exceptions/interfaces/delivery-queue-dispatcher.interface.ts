export const IDeliveryQueueDispatcher = Symbol('IDeliveryQueueDispatcher');

export interface DeliveryPayload {
  traceId: string;
  srcDataSourceId: string;
  destDataSourceId: string;
  routeId: string;
  hydratedPayload: unknown;
}

export interface IDeliveryQueueDispatcher {
  /**
   * Dispatches a payload to the delivery queue for retry processing.
   */
  dispatchRetry(payload: DeliveryPayload): Promise<void>;
}
