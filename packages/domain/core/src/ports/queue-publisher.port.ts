export interface IQueuePublisherPort {
  publish<T>(queueName: string, message: T, delaySeconds?: number): Promise<void>;
}
