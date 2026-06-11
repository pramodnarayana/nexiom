import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PipelineHookBrokerService } from './pipeline-hook-broker.service.js';
import { EventEmitter2 } from '@nestjs/event-emitter';

describe('PipelineHookBrokerService', () => {
  let service: PipelineHookBrokerService;
  let eventEmitter: EventEmitter2;

  beforeEach(() => {
    eventEmitter = {
      emitAsync: vi.fn(),
    } as unknown as EventEmitter2;
    
    service = new PipelineHookBrokerService(eventEmitter);

    vi.clearAllMocks();
  });

  describe('extractReplica', () => {
    it('emits event and returns result', async () => {
      (eventEmitter.emitAsync as any).mockResolvedValue([{ entityType: 'contact', data: {} }]);
      const result = await service.extractReplica('salesforce', 'standard', { foo: 'bar' });
      expect(eventEmitter.emitAsync).toHaveBeenCalledWith('shard.extractReplica', { appName: 'salesforce', appProfile: 'standard', data: { foo: 'bar' } });
      expect(result).toEqual({ entityType: 'contact', data: {} });
    });
  });

  describe('normalize', () => {
    it('emits event and returns result', async () => {
      (eventEmitter.emitAsync as any).mockResolvedValue([[{ entityType: 'Contact', data: {} }]]);
      const replica = { entityType: 'contact', data: { id: '1' } };
      const result = await service.normalize('salesforce', 'standard', replica);
      expect(eventEmitter.emitAsync).toHaveBeenCalledWith('shard.normalize', { appName: 'salesforce', appProfile: 'standard', replica });
      expect(result).toEqual([{ entityType: 'Contact', data: {} }]);
    });
  });

  describe('writeNormalized', () => {
    it('emits event', async () => {
      (eventEmitter.emitAsync as any).mockResolvedValue([undefined]);
      await service.writeNormalized('salesforce', 'standard', {}, {} as any, 'public', 'r-1', 'e-1', 't-1', 'Contact', { foo: 'bar' });
      expect(eventEmitter.emitAsync).toHaveBeenCalledWith('shard.writeNormalized', {
        appName: 'salesforce', appProfile: 'standard', tx: {}, db: {}, schemaName: 'public', replicaId: 'r-1', entityId: 'e-1', traceId: 't-1', normalizedEntityType: 'Contact', data: { foo: 'bar' }
      });
    });
  });

  describe('buildTarget', () => {
    it('emits event and returns result', async () => {
      (eventEmitter.emitAsync as any).mockResolvedValue([{ mappedId: '123' }]);
      const result = await service.buildTarget('salesforce', 'standard', {} as any, 'public', 'Contact', 'src-1');
      expect(eventEmitter.emitAsync).toHaveBeenCalledWith('shard.buildTarget', {
        appName: 'salesforce', appProfile: 'standard', db: {}, schemaName: 'public', normalizedEntityType: 'Contact', srcEntityId: 'src-1'
      });
      expect(result).toEqual({ mappedId: '123' });
    });

    it('returns empty object if emit returns null', async () => {
      (eventEmitter.emitAsync as any).mockResolvedValue([null]);
      const result = await service.buildTarget('salesforce', 'standard', {} as any, 'public', 'Contact', 'src-1');
      expect(result).toEqual({});
    });
  });

  describe('provisionDomain', () => {
    it('emits event', async () => {
      (eventEmitter.emitAsync as any).mockResolvedValue([undefined]);
      await service.provisionDomain('salesforce', 'standard', {} as any, 'public');
      expect(eventEmitter.emitAsync).toHaveBeenCalledWith('shard.provisionDomain', {
        appName: 'salesforce', appProfile: 'standard', db: {}, schemaName: 'public'
      });
    });
  });

  describe('prepareUpdate', () => {
    it('emits event and returns result', async () => {
      (eventEmitter.emitAsync as any).mockResolvedValue([{ id: '123', name: 'Test' }]);
      const result = await service.prepareUpdate('salesforce', 'standard', { name: 'Test' }, '123', { etag: 'x' });
      expect(eventEmitter.emitAsync).toHaveBeenCalledWith('shard.prepareUpdate', {
        appName: 'salesforce', appProfile: 'standard', data: { name: 'Test' }, destId: '123', destState: { etag: 'x' }
      });
      expect(result).toEqual({ id: '123', name: 'Test' });
    });

    it('returns payload if emit returns null', async () => {
      (eventEmitter.emitAsync as any).mockResolvedValue([null]);
      const result = await service.prepareUpdate('salesforce', 'standard', { name: 'Test' }, '123', { etag: 'x' });
      expect(result).toEqual({ name: 'Test' });
    });
  });

  describe('getWebhookResponse', () => {
    it('emits event and returns result', async () => {
      (eventEmitter.emitAsync as any).mockResolvedValue([{ status: 200, body: 'ok' }]);
      const result = await service.getWebhookResponse('salesforce', 'standard', { payload: 'foo' }, { 'x-header': 'bar' });
      expect(eventEmitter.emitAsync).toHaveBeenCalledWith('shard.getWebhookResponse', {
        appName: 'salesforce', appProfile: 'standard', body: { payload: 'foo' }, headers: { 'x-header': 'bar' }
      });
      expect(result).toEqual({ status: 200, body: 'ok' });
    });

    it('returns null if emit returns null', async () => {
      (eventEmitter.emitAsync as any).mockResolvedValue([null]);
      const result = await service.getWebhookResponse('salesforce', 'standard', {}, {});
      expect(result).toBeNull();
    });
  });

  describe('activeFetch', () => {
    it('emits event', async () => {
      (eventEmitter.emitAsync as any).mockResolvedValue([undefined]);
      await service.activeFetch('salesforce', 'standard', [{ entityType: 'Account', sourceId: '123' }], 'ds-1');
      expect(eventEmitter.emitAsync).toHaveBeenCalledWith('shard.activeFetch', {
        appName: 'salesforce', appProfile: 'standard', missingDependencies: [{ entityType: 'Account', sourceId: '123' }], dataSourceId: 'ds-1'
      });
    });
  });

  describe('reverseLookup', () => {
    it('emits event and returns result', async () => {
      (eventEmitter.emitAsync as any).mockResolvedValue([['p-1', 'p-2']]);
      const result = await service.reverseLookup('salesforce', 'standard', {} as any, 'public', 'Contact', 'c-1');
      expect(eventEmitter.emitAsync).toHaveBeenCalledWith('shard.reverseLookup', {
        appName: 'salesforce', appProfile: 'standard', db: {}, schemaName: 'public', normalizedEntityType: 'Contact', entityId: 'c-1'
      });
      expect(result).toEqual(['p-1', 'p-2']);
    });

    it('returns empty array if emit returns null', async () => {
      (eventEmitter.emitAsync as any).mockResolvedValue([null]);
      const result = await service.reverseLookup('salesforce', 'standard', {} as any, 'public', 'Contact', 'c-1');
      expect(result).toEqual([]);
    });
  });
});
