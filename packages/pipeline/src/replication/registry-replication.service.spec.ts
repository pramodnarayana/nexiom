import { describe, it, expect, vi, beforeEach, Mocked } from 'vitest';
import { RegistryReplicationService } from './registry-replication.service.js';
import { QueueService, QueueName } from '@soopa/queue';
import type { RegistryReplicationPort } from "../shared/domain.js";
import { DB_MANAGER, SchemaPlan, getWorkspaceSchemaName } from '@soopa/dbmanager';
import type { DatabaseManager } from '@soopa/dbmanager';

describe('RegistryReplicationService', () => {
  let queueService: Mocked<QueueService>;
  let registryPort: Mocked<RegistryReplicationPort>;
  let dbManager: Mocked<DatabaseManager>;
  let service: RegistryReplicationService;

  beforeEach(() => {
    queueService = {
      consume: vi.fn(),
    } as any;

    registryPort = {
      fetchGlobalOutboxRecord: vi.fn(),
      replicateEntity: vi.fn(),
      getStitchDataSources: vi.fn(),
      markGlobalOutboxSuccess: vi.fn(),
      markConnectionStatus: vi.fn(),
    };

    dbManager = {
      applyPlan: vi.fn(),
    } as any;

    service = new RegistryReplicationService(queueService, registryPort, dbManager);
  });

  it('initializes queue consumer on module init and handles invalid messages', async () => {
    service.onModuleInit();
    expect(queueService.consume).toHaveBeenCalledWith(QueueName.RegistryReplicationQueue, expect.any(Function));
    
    // Test the consume callback
    const consumeCallback = queueService.consume.mock.calls[0][1];
    
    // Invalid message
    await consumeCallback({});
    expect(registryPort.fetchGlobalOutboxRecord).not.toHaveBeenCalled();
    
    // Valid message
    registryPort.fetchGlobalOutboxRecord.mockResolvedValue(null);
    await consumeCallback({ outboxId: 'outbox-cb' });
    expect(registryPort.fetchGlobalOutboxRecord).toHaveBeenCalledWith('outbox-cb');
  });

  it('processes simple registry replication message', async () => {
    registryPort.fetchGlobalOutboxRecord.mockResolvedValue({
      id: 'outbox-1',
      tenantId: 'ten-1',
      action: 'UPSERT',
      status: 'PENDING',
      entityType: 'APP_CONNECTION',
      entityId: 'ds-1',
      payload: { foo: 'bar' },
    });

    await (service as any).processMessage('outbox-1');

    expect(registryPort.fetchGlobalOutboxRecord).toHaveBeenCalledWith('outbox-1');
    expect(registryPort.replicateEntity).toHaveBeenCalledWith('ten-1', 'UPSERT', 'APP_CONNECTION', 'ds-1', { foo: 'bar' });
    expect(registryPort.markGlobalOutboxSuccess).toHaveBeenCalledWith('outbox-1');
  });

  it('skips processing if outbox record not found', async () => {
    registryPort.fetchGlobalOutboxRecord.mockResolvedValue(null);

    await (service as any).processMessage('outbox-1');

    expect(registryPort.replicateEntity).not.toHaveBeenCalled();
    expect(registryPort.markGlobalOutboxSuccess).not.toHaveBeenCalled();
  });

  it('throws error for unrecognized action', async () => {
    registryPort.fetchGlobalOutboxRecord.mockResolvedValue({
      id: 'outbox-1',
      tenantId: 'ten-1',
      action: 'UNKNOWN_ACTION' as any,
      status: 'PENDING',
      entityType: 'APP_CONNECTION',
      entityId: 'ds-1',
      payload: {},
    });

    await expect((service as any).processMessage('outbox-1')).rejects.toThrow('Unrecognized registry outbox operation: action="UNKNOWN_ACTION", entityType="APP_CONNECTION"');
  });



  it('retries on foreign key constraint violation and eventually succeeds', async () => {
    registryPort.fetchGlobalOutboxRecord.mockResolvedValue({
      id: 'outbox-1',
      tenantId: 'ten-1',
      action: 'UPSERT',
      status: 'PENDING',
      entityType: 'FIELD_MAPPING', // field mapping gives max 10 attempts
      entityId: 'fm-1',
      payload: {},
    });

    const fkError = new Error('foreign key constraint violation');
    (fkError as any).code = '23503';

    // Fail first time, succeed second
    registryPort.replicateEntity
      .mockRejectedValueOnce(fkError)
      .mockResolvedValueOnce(undefined);

    await (service as any).processMessage('outbox-1');

    expect(registryPort.replicateEntity).toHaveBeenCalledTimes(2);
    expect(registryPort.markGlobalOutboxSuccess).toHaveBeenCalledWith('outbox-1');
  });

  it('throws error if foreign key constraint violation exhausts all attempts', async () => {
    registryPort.fetchGlobalOutboxRecord.mockResolvedValue({
      id: 'outbox-1',
      tenantId: 'ten-1',
      action: 'UPSERT',
      status: 'PENDING',
      entityType: 'APP_CONNECTION', // gives max 3 attempts
      entityId: 'ds-1',
      payload: {},
    });

    const fkError = new Error('foreign key constraint violation');
    (fkError as any).code = '23503';

    // Always fail
    registryPort.replicateEntity.mockRejectedValue(fkError);

    await expect((service as any).processMessage('outbox-1')).rejects.toThrow('foreign key constraint violation');
    expect(registryPort.replicateEntity).toHaveBeenCalledTimes(3);
    expect(registryPort.markGlobalOutboxSuccess).not.toHaveBeenCalled();
  });
});
