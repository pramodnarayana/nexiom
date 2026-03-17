/**
 * Queue names must match the values used in `scripts/init-localstack.sh`
 * (LocalStack creates queues by these names on startup).
 */
export enum QueueName {
  Inbound_Queue = "inbound-queue",
  Replica_Queue = "replica-queue",
  Normalized_Queue = "normalized-queue",
  Delivery_Queue = "delivery-queue",

  // Dead-letter queues — activated after 5 failed attempts
  Inbound_Queue_DLQ = "inbound-queue-dlq",
  Replica_Queue_DLQ = "replica-queue-dlq",
  Normalized_Queue_DLQ = "normalized-queue-dlq",
  Delivery_Queue_DLQ = "delivery-queue-dlq",
}

/** Injection token — use to inject QueueService across the application. */
export const QUEUE_SERVICE = "QUEUE_SERVICE" as const;

/** Internal token — carries module options to QueueService via DI. */
export const QUEUE_MODULE_OPTIONS = "QUEUE_MODULE_OPTIONS" as const;
