export interface QueuePublisherPort {
  publish<T>(queueName: string, message: T, delaySeconds?: number): Promise<void>;
}
