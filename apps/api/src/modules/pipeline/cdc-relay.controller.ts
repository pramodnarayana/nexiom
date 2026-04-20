import {
  Controller,
  Post,
  Body,
  UseGuards,
  HttpCode,
  Logger,
} from '@nestjs/common';
import { QueueService, QueueName } from '@nexiom/queue';
import { CdcRelayGuard } from './cdc-relay.guard.js';
import { DebeziumUnwrappedEvent } from './debezium-event.js';

@Controller('internal/cdc')
@UseGuards(CdcRelayGuard)
export class CdcRelayController {
  private readonly logger = new Logger(CdcRelayController.name);

  constructor(private readonly queueService: QueueService) {}

  @Post('relay')
  @HttpCode(202)
  async relay(@Body() event: DebeziumUnwrappedEvent): Promise<void> {
    const { __table, __schema, __op, trace_id, connection_id } = event;

    // Only process inserts; updates/deletes are ignored as outboxes append-only
    if (__op !== 'c') {
      return;
    }

    if (__table === 'inbound_outbox') {
      await this.queueService.send(QueueName.InboundQueue, {
        traceId: trace_id,
        connectionId: connection_id,
        schemaName: __schema,
      });
      this.logger.debug(
        `Relayed L1->L2 event for trace=${trace_id} (schema=${__schema}) to ${QueueName.InboundQueue}`,
      );
    } else if (__table === 'replica_outbox') {
      await this.queueService.send(QueueName.ReplicaQueue, {
        traceId: trace_id,
        connectionId: connection_id,
        schemaName: __schema,
      });
      this.logger.debug(
        `Relayed L2->L3 event for trace=${trace_id} (schema=${__schema}) to ${QueueName.ReplicaQueue}`,
      );
    } else {
      this.logger.warn(
        `Received CDC relay for unknown table: ${String(__table)}`,
      );
    }
  }
}
