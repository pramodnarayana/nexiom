import {
  Controller,
  Post,
  Body,
  UseGuards,
  HttpCode,
  Logger,
  UsePipes,
  ValidationPipe,
  BadRequestException,
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
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      exceptionFactory: (errors) => {
        const logger = new Logger('CdcRelayValidation');
        logger.error(
          { event: 'cdc.validation_failed', errors },
          'CDC Relay rejected payload due to validation errors',
        );
        return new BadRequestException(errors);
      },
    }),
  )
  async relay(@Body() event: DebeziumUnwrappedEvent): Promise<void> {
    const { __table, __op, trace_id, data_source_id, schema_name, __schema } =
      event;

    // Fallback to Debezium's metadata __schema if the table lacks a schema_name column
    // This is required to support historic WAL events that occurred before the schema migration.
    const resolvedSchema = schema_name ?? __schema;

    // Only process inserts; updates/deletes are ignored as outboxes append-only
    if (__op !== 'c') {
      return;
    }

    if (__table === 'inbound_outbox') {
      await this.queueService.send(QueueName.InboundQueue, {
        traceId: trace_id,
        dataSourceId: data_source_id,
        schemaName: resolvedSchema,
      });
      this.logger.debug(
        `Relayed L1->L2 event for trace=${trace_id} (schema=${resolvedSchema}) to ${QueueName.InboundQueue}`,
      );
    } else if (__table === 'replica_outbox') {
      await this.queueService.send(QueueName.ReplicaQueue, {
        traceId: trace_id,
        dataSourceId: data_source_id,
        schemaName: resolvedSchema,
      });
      this.logger.debug(
        `Relayed L2->L3 event for trace=${trace_id} (schema=${resolvedSchema}) to ${QueueName.ReplicaQueue}`,
      );
    } else if (__table === 'normalized_outbox') {
      await this.queueService.send(QueueName.NormalizedQueue, {
        traceId: trace_id,
        dataSourceId: data_source_id,
        schemaName: resolvedSchema,
      });
      this.logger.log(
        `[DEBUG] Relayed L3->L4 event for trace=${trace_id} (schema=${resolvedSchema}) to ${QueueName.NormalizedQueue}`,
      );
    } else if (__table === 'outbound_outbox') {
      // outbound_outbox is handled by the OutboundOutboxWorker via DB polling.
      // We don't relay it to the queue from CDC because the queue payload requires the full JSONB payload blob.
      this.logger.debug(
        `[DEBUG] Ignored CDC event for outbound_outbox (trace=${trace_id}) — handled by worker polling`,
      );
    } else {
      this.logger.warn(
        `Received CDC relay for unknown table: ${String(__table)}`,
      );
    }
  }
}
