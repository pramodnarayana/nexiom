// Production CDC Relay Lambda
// Triggered natively by Amazon Kinesis Data Streams (Debezium Kinesis Sink)
// Pushes messages to SQS InboundQueue / ReplicaQueue
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import type { KinesisStreamHandler } from 'aws-lambda';

const sqs = new SQSClient({});

export const handler: KinesisStreamHandler = async (event) => {
  for (const record of event.Records) {
    const payload = JSON.parse(
      Buffer.from(record.kinesis.data, 'base64').toString('utf-8'),
    );
    const { __table, __op, trace_id, connection_id, schema_name } = payload;

    // Only enqueue insert events; updates/deletes are not needed for outbox pattern
    if (__op !== 'c') {
      continue;
    }

    // Only route outbox tables; ignore other tables
    if (__table !== 'inbound_outbox' && __table !== 'replica_outbox') {
      continue;
    }

    const queueUrl =
      __table === 'inbound_outbox'
        ? process.env.INBOUND_QUEUE_URL!
        : process.env.REPLICA_QUEUE_URL!;

    if (!queueUrl) {
      throw new Error(`Queue URL not defined for __table: ${__table}`);
    }

    await sqs.send(
      new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: JSON.stringify({
          traceId: trace_id,
          connectionId: connection_id,
          schemaName: schema_name,
        }),
      }),
    );
  }
};