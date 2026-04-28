import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { QueueService, QueueName } from '@nexiom/queue';
import { CdcRelayController } from './cdc-relay.controller.js';
import { CdcRelayGuard } from './cdc-relay.guard.js';

describe('CdcRelayController', () => {
  let controller: CdcRelayController;
  let mockQueueService: Partial<QueueService>;

  beforeEach(async () => {
    mockQueueService = {
      send: vi.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [CdcRelayController],
      providers: [{ provide: QueueService, useValue: mockQueueService }],
    })
      .overrideGuard(CdcRelayGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = moduleRef.get(CdcRelayController);
  });

  it('routes inbound_outbox inserts to InboundQueue', async () => {
    await controller.relay({
      __op: 'c',
      __table: 'inbound_outbox',
      __schema: 'debezium_metadata_schema',
      schema_name: 'ws_sf_123',
      trace_id: 'trace-1',
      connection_id: 'conn-1',
    });

    expect(mockQueueService.send).toHaveBeenCalledWith(QueueName.InboundQueue, {
      traceId: 'trace-1',
      connectionId: 'conn-1',
      schemaName: 'ws_sf_123',
    });
  });

  it('routes replica_outbox inserts to ReplicaQueue', async () => {
    await controller.relay({
      __op: 'c',
      __table: 'replica_outbox',
      __schema: 'debezium_metadata_schema',
      schema_name: 'ws_qb_456',
      trace_id: 'trace-2',
      connection_id: 'conn-2',
    });

    expect(mockQueueService.send).toHaveBeenCalledWith(QueueName.ReplicaQueue, {
      traceId: 'trace-2',
      connectionId: 'conn-2',
      schemaName: 'ws_qb_456',
    });
  });

  it('ignores updates and deletes', async () => {
    await controller.relay({
      __op: 'u',
      __table: 'inbound_outbox',
      __schema: 'ws_sf_123',
      schema_name: 'ws_sf_123',
      trace_id: 'trace-3',
      connection_id: 'conn-3',
    });

    await controller.relay({
      __op: 'd',
      __table: 'replica_outbox',
      __schema: 'ws_qb_456',
      schema_name: 'ws_qb_456',
      trace_id: 'trace-4',
      connection_id: 'conn-4',
    });

    expect(mockQueueService.send).not.toHaveBeenCalled();
  });

  it('routes normalized_outbox inserts to NormalizedQueue', async () => {
    await controller.relay({
      __op: 'c',
      __table: 'normalized_outbox',
      __schema: 'debezium_metadata_schema',
      schema_name: 'ws_normalized_123',
      trace_id: 'trace-6',
      connection_id: 'conn-6',
    });

    expect(mockQueueService.send).toHaveBeenCalledWith(
      QueueName.NormalizedQueue,
      {
        traceId: 'trace-6',
        connectionId: 'conn-6',
        schemaName: 'ws_normalized_123',
      },
    );
  });

  it('ignores delivery_outbox inserts', async () => {
    await controller.relay({
      __op: 'c',
      __table: 'delivery_outbox',
      __schema: 'debezium_metadata_schema',
      schema_name: 'ws_delivery_123',
      trace_id: 'trace-7',
      connection_id: 'conn-7',
    });

    expect(mockQueueService.send).not.toHaveBeenCalled();
  });

  it('ignores unknown tables', async () => {
    await controller.relay({
      __op: 'c',
      __table: 'unknown_table' as unknown as 'inbound_outbox',
      __schema: 'public',
      schema_name: 'public',
      trace_id: 'trace-5',
      connection_id: 'conn-5',
    });

    expect(mockQueueService.send).not.toHaveBeenCalled();
  });
});
