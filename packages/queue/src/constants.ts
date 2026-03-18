/**
 * Queue names must match the values used in `scripts/init-localstack.sh`
 * (LocalStack creates queues by these names on startup).
 */
export enum QueueName {
  InboundQueue = "inbound-queue",
  ReplicaQueue = "replica-queue",
  NormalizedQueue = "normalized-queue",
  DeliveryQueue = "delivery-queue",

  // Dead-letter queues — activated after 5 failed attempts
  InboundQueueDLQ = "inbound-queue-dlq",
  ReplicaQueueDLQ = "replica-queue-dlq",
  NormalizedQueueDLQ = "normalized-queue-dlq",
  DeliveryQueueDLQ = "delivery-queue-dlq",
}

/** Injection token — use to inject QueueService across the application. */
export const QUEUE_SERVICE = "QUEUE_SERVICE" as const;

/** Internal token — carries module options to QueueService via DI. */
export const QUEUE_MODULE_OPTIONS = "QUEUE_MODULE_OPTIONS" as const;
