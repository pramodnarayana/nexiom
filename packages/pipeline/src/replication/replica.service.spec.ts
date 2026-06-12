import { describe, it, expect, vi, beforeEach, Mocked } from 'vitest';
import { ReplicaService } from './replica.service.js';
import { QueueService, QueueName } from '@soopa/queue';
import { StorageResolverService } from '../storage-resolver/storage-resolver.service.js';
import { PipelineHookBrokerService } from '../sharding/pipeline-hook-broker.service.js';
import type { IReplicaStatePort } from "../shared/domain.js";
import { FakeConnectionRepository } from '../shared/fakes/fake-connection.repository.js';
import { DependenciesMissingError } from '@soopa/piece-framework';

describe('ReplicaService', () => {
  let queueService: Mocked<QueueService>;
  let connectionRepository: FakeConnectionRepository;
  let replicaStatePort: Mocked<IReplicaStatePort>;
  let storageResolver: Mocked<StorageResolverService>;
  let hookBroker: Mocked<PipelineHookBrokerService>;
  let service: ReplicaService;

  beforeEach(() => {
    queueService = {
      consume: vi.fn(),
    } as any;

    connectionRepository = new FakeConnectionRepository();

    replicaStatePort = {
      fetchInboundRecord: vi.fn(),
      persistReplicaExtraction: vi.fn(),
      markInboundFail: vi.fn(),
    } as any;

    storageResolver = {
      resolveStorageProfile: vi.fn().mockResolvedValue({ schemaName: 'ws_ds-1', tenantId: 'ten-1' }),
    } as any;

    hookBroker = {
      extractReplica: vi.fn(),
    } as any;

    service = new ReplicaService(
      queueService,
      connectionRepository,
      replicaStatePort,
      storageResolver,
      hookBroker
    );
  });

  it('initializes queue consumer on module init and processes messages', async () => {
    service.onModuleInit();
    expect(queueService.consume).toHaveBeenCalledWith(QueueName.InboundQueue, expect.any(Function));
    
    // Test the consume callback
    const consumeCallback = queueService.consume.mock.calls[0][1];
    
    // Setup for successful processMessage
    connectionRepository.connections.push({ dataSourceId: 'ds-cb', tenantId: 'ten-cb', appName: 'salesforce', appProfile: 'standard' } as any);
    replicaStatePort.fetchInboundRecord.mockResolvedValue({ id: 'inb-cb', status: 'PENDING', request: {} } as any);
    hookBroker.extractReplica.mockResolvedValue({ entityId: 'ent-cb', entityType: 'Contact', data: {} });
    storageResolver.resolveStorageProfile.mockResolvedValue({ schemaName: 'ws_ds-cb', tenantId: 'ten-cb' });
    
    await consumeCallback({ traceId: 'tr-cb', dataSourceId: 'ds-cb' });
    expect(replicaStatePort.persistReplicaExtraction).toHaveBeenCalled();
  });

  it('processes simple inbound replication message successfully', async () => {
    connectionRepository.connections.push({ dataSourceId: 'ds-1', tenantId: 'ten-1', appName: 'salesforce', appProfile: 'standard' } as any);

    replicaStatePort.fetchInboundRecord.mockResolvedValue({
      id: 'inbound-1',
      status: 'PENDING',
      request: { foo: 'bar' },
    } as any);

    hookBroker.extractReplica.mockResolvedValue({
      entityId: 'ent-1',
      entityType: 'Contact',
      data: { foo: 'bar' },
    });

    const msg = { traceId: 'tr-1', dataSourceId: 'ds-1' };
    await (service as any).processMessage(msg);

    expect(storageResolver.resolveStorageProfile).toHaveBeenCalledWith('ds-1');
    expect(replicaStatePort.fetchInboundRecord).toHaveBeenCalledWith('ten-1', 'ws_ds-1', 'tr-1');
    expect(hookBroker.extractReplica).toHaveBeenCalledWith('salesforce', 'standard', { foo: 'bar' });
    expect(replicaStatePort.persistReplicaExtraction).toHaveBeenCalledWith(
      'ten-1',
      'ws_ds-1',
      'ds-1',
      'tr-1',
      'inbound-1',
      { entityId: 'ent-1', entityType: 'Contact', data: { foo: 'bar' } },
      expect.any(Number)
    );
  });

  it('skips processing if trace is already SUCCESS', async () => {
    connectionRepository.connections.push({ dataSourceId: 'ds-1', tenantId: 'ten-1', appName: 'salesforce', appProfile: 'standard' } as any);

    replicaStatePort.fetchInboundRecord.mockResolvedValue({
      id: 'inbound-1',
      status: 'SUCCESS',
      request: { foo: 'bar' },
    } as any);

    const msg = { traceId: 'tr-1', dataSourceId: 'ds-1' };
    await (service as any).processMessage(msg);

    expect(hookBroker.extractReplica).not.toHaveBeenCalled();
    expect(replicaStatePort.persistReplicaExtraction).not.toHaveBeenCalled();
  });

  it('throws error and marks FAIL if extraction returns null', async () => {
    connectionRepository.connections.push({ dataSourceId: 'ds-1', tenantId: 'ten-1', appName: 'salesforce', appProfile: 'standard' } as any);

    replicaStatePort.fetchInboundRecord.mockResolvedValue({
      id: 'inbound-1',
      status: 'PENDING',
      request: { foo: 'bar' },
    } as any);

    hookBroker.extractReplica.mockResolvedValue(null as any);

    const msg = { traceId: 'tr-1', dataSourceId: 'ds-1' };
    await expect((service as any).processMessage(msg)).rejects.toThrow('Replica extraction failed for traceId tr-1');

    expect(replicaStatePort.markInboundFail).toHaveBeenCalledWith('ten-1', 'ws_ds-1', 'tr-1', expect.stringContaining('Replica extraction failed for traceId tr-1'), expect.any(Number));
  });

  it('throws error and marks FAIL if extraction missing entityId', async () => {
    connectionRepository.connections.push({ dataSourceId: 'ds-1', tenantId: 'ten-1', appName: 'salesforce', appProfile: 'standard' } as any);

    replicaStatePort.fetchInboundRecord.mockResolvedValue({
      id: 'inbound-1',
      status: 'PENDING',
      request: { foo: 'bar' },
    } as any);

    hookBroker.extractReplica.mockResolvedValue({
      entityId: '',
      entityType: 'Contact',
      data: {},
    });

    const msg = { traceId: 'tr-1', dataSourceId: 'ds-1' };
    await expect((service as any).processMessage(msg)).rejects.toThrow('Cannot determine entityId for traceId tr-1');

    expect(replicaStatePort.markInboundFail).toHaveBeenCalledWith('ten-1', 'ws_ds-1', 'tr-1', expect.stringContaining('Cannot determine entityId for traceId tr-1'), expect.any(Number));
  });

  it('throws DependenciesMissingError if connection metadata missing', async () => {
    // repository will return undefined for ds-1
    const msg = { traceId: 'tr-1', dataSourceId: 'ds-1' };
    await expect((service as any).processMessage(msg)).rejects.toThrow(DependenciesMissingError);
    // Should still mark as fail
    expect(replicaStatePort.markInboundFail).toHaveBeenCalledWith('ten-1', 'ws_ds-1', 'tr-1', expect.stringContaining('Missing dependencies'), expect.any(Number));
  });

  it('throws error if schema mismatch detected', async () => {
    const msg = { traceId: 'tr-1', dataSourceId: 'ds-1', schemaName: 'ws_other' };
    await expect((service as any).processMessage(msg)).rejects.toThrow('Schema mismatch: msg.schemaName=ws_other but resolved=ws_ds-1');
  });

  it('does not mark as FAIL if lock contention detected', async () => {
    connectionRepository.connections.push({ dataSourceId: 'ds-1', tenantId: 'ten-1', appName: 'salesforce', appProfile: 'standard' } as any);

    replicaStatePort.fetchInboundRecord.mockResolvedValue({
      id: 'inbound-1',
      status: 'PENDING',
      request: { foo: 'bar' },
    } as any);

    hookBroker.extractReplica.mockResolvedValue({
      entityId: 'ent-1',
      entityType: 'Contact',
      data: { foo: 'bar' },
    });

    const lockError = new Error('Lock Content');
    (lockError as any).isLockContention = true;

    replicaStatePort.persistReplicaExtraction.mockRejectedValue(lockError);

    const msg = { traceId: 'tr-1', dataSourceId: 'ds-1' };
    await expect((service as any).processMessage(msg)).rejects.toThrow('Lock Content');
    
    // Crucially, markInboundFail should NOT be called
    expect(replicaStatePort.markInboundFail).not.toHaveBeenCalled();
  });

  it('throws error if inbound record not found', async () => {
    connectionRepository.connections.push({ dataSourceId: 'ds-1', tenantId: 'ten-1', appName: 'salesforce', appProfile: 'standard' } as any);
    replicaStatePort.fetchInboundRecord.mockResolvedValue(null);

    const msg = { traceId: 'tr-1', dataSourceId: 'ds-1' };
    await expect((service as any).processMessage(msg)).rejects.toThrow('Inbound record for traceId tr-1 not found');
  });

  it('handles error when effectiveSchemaName or effectiveTenantId is undefined', async () => {
    storageResolver.resolveStorageProfile.mockRejectedValue(new Error('Storage failure'));

    const msg = { traceId: 'tr-1', dataSourceId: 'ds-1' };
    await expect((service as any).processMessage(msg)).rejects.toThrow('Storage failure');
    
    // markInboundFail should not be called because effectiveSchemaName/TenantId are undefined
    expect(replicaStatePort.markInboundFail).not.toHaveBeenCalled();
  });

  it('logs error when markInboundFail itself fails', async () => {
    connectionRepository.connections.push({ dataSourceId: 'ds-1', tenantId: 'ten-1', appName: 'salesforce', appProfile: 'standard' } as any);
    replicaStatePort.fetchInboundRecord.mockRejectedValue(new Error('Fetch failure'));
    replicaStatePort.markInboundFail.mockRejectedValue(new Error('Mark fail failure'));

    const msg = { traceId: 'tr-1', dataSourceId: 'ds-1' };
    await expect((service as any).processMessage(msg)).rejects.toThrow('Fetch failure');
    
    // It should have tried to mark as fail, but the rejection is swallowed
    expect(replicaStatePort.markInboundFail).toHaveBeenCalled();
  });
});
