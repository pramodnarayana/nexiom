import { Test, TestingModule } from '@nestjs/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PipelineHookBrokerService } from './pipeline-hook-broker.service.js';
import { ApplicationLoaderService } from './application-loader.service.js';

describe('PipelineHookBrokerService', () => {
  let service: PipelineHookBrokerService;
  let loader: ApplicationLoaderService;

  const mockShard = {
    extractReplica: vi.fn(),
    normalize: vi.fn(),
    writeNormalized: vi.fn(),
    buildTarget: vi.fn(),
    provisionDomain: vi.fn(),
    prepareUpdate: vi.fn(),
    getWebhookResponse: vi.fn(),
    activeFetch: vi.fn(),
    reverseLookup: vi.fn(),
  };

  beforeEach(() => {
    loader = {
      load: vi.fn().mockResolvedValue(mockShard),
    } as unknown as ApplicationLoaderService;
    
    service = new PipelineHookBrokerService(loader);

    // Reset mocks
    vi.clearAllMocks();
  });

  describe('extractReplica', () => {
    it('delegates to shard', async () => {
      mockShard.extractReplica.mockResolvedValue({ entityType: 'contact', data: {} });
      const result = await service.extractReplica('salesforce', 'standard', { foo: 'bar' });
      expect(loader.load).toHaveBeenCalledWith('salesforce/standard');
      expect(mockShard.extractReplica).toHaveBeenCalledWith({ foo: 'bar' });
      expect(result).toEqual({ entityType: 'contact', data: {} });
    });
  });

  describe('normalize', () => {
    it('delegates to shard', async () => {
      mockShard.normalize.mockResolvedValue([{ entityType: 'Contact', data: {} }]);
      const replica = { entityType: 'contact', data: { id: '1' } };
      const result = await service.normalize('salesforce', 'standard', replica);
      expect(loader.load).toHaveBeenCalledWith('salesforce/standard');
      expect(mockShard.normalize).toHaveBeenCalledWith(replica);
      expect(result).toEqual([{ entityType: 'Contact', data: {} }]);
    });
  });

  describe('writeNormalized', () => {
    it('delegates to shard if method exists', async () => {
      mockShard.writeNormalized.mockResolvedValue(undefined);
      await service.writeNormalized('salesforce', 'standard', {}, {} as any, 'public', 'r-1', 'e-1', 't-1', 'Contact', { foo: 'bar' });
      expect(loader.load).toHaveBeenCalledWith('salesforce/standard');
      expect(mockShard.writeNormalized).toHaveBeenCalledWith({}, {}, 'public', 'r-1', 'e-1', 't-1', 'Contact', { foo: 'bar' });
    });

    it('returns immediately if method is not implemented', async () => {
      const incompleteShard = { extractReplica: vi.fn(), normalize: vi.fn() };
      (loader.load as any).mockResolvedValue(incompleteShard);
      await service.writeNormalized('salesforce', 'standard', {}, {} as any, 'public', 'r-1', 'e-1', 't-1', 'Contact', { foo: 'bar' });
      expect(loader.load).toHaveBeenCalledWith('salesforce/standard');
      // No error thrown
    });
  });

  describe('buildTarget', () => {
    it('delegates to shard if method exists', async () => {
      mockShard.buildTarget.mockResolvedValue({ mappedId: '123' });
      const result = await service.buildTarget('salesforce', 'standard', {} as any, 'public', 'Contact', 'src-1');
      expect(loader.load).toHaveBeenCalledWith('salesforce/standard');
      expect(mockShard.buildTarget).toHaveBeenCalledWith({}, 'public', 'Contact', 'src-1');
      expect(result).toEqual({ mappedId: '123' });
    });

    it('returns empty object if method does not exist', async () => {
      const incompleteShard = { extractReplica: vi.fn(), normalize: vi.fn() };
      (loader.load as any).mockResolvedValue(incompleteShard);
      const result = await service.buildTarget('salesforce', 'standard', {} as any, 'public', 'Contact', 'src-1');
      expect(result).toEqual({});
    });
  });

  describe('provisionDomain', () => {
    it('delegates to shard if method exists', async () => {
      mockShard.provisionDomain.mockResolvedValue(undefined);
      await service.provisionDomain('salesforce', 'standard', {} as any, 'public');
      expect(loader.load).toHaveBeenCalledWith('salesforce/standard');
      expect(mockShard.provisionDomain).toHaveBeenCalledWith({}, 'public');
    });

    it('returns without error if method is omitted', async () => {
      const incompleteShard = { extractReplica: vi.fn(), normalize: vi.fn() };
      (loader.load as any).mockResolvedValue(incompleteShard);
      await expect(service.provisionDomain('salesforce', 'standard', {} as any, 'public')).resolves.toBeUndefined();
    });
  });

  describe('prepareUpdate', () => {
    it('delegates to shard if method exists', async () => {
      mockShard.prepareUpdate.mockResolvedValue({ id: '123', name: 'Test' });
      const result = await service.prepareUpdate('salesforce', 'standard', { name: 'Test' }, '123', { etag: 'x' });
      expect(loader.load).toHaveBeenCalledWith('salesforce/standard');
      expect(mockShard.prepareUpdate).toHaveBeenCalledWith({ name: 'Test' }, '123', { etag: 'x' });
      expect(result).toEqual({ id: '123', name: 'Test' });
    });

    it('returns raw payload if load throws ENOENT', async () => {
      const error = new Error('Cannot find module');
      (error as any).code = 'ENOENT';
      (loader.load as any).mockRejectedValue(error);
      const result = await service.prepareUpdate('salesforce', 'standard', { name: 'Test' }, '123', { etag: 'x' });
      expect(result).toEqual({ name: 'Test' });
    });

    it('returns raw payload if method is omitted', async () => {
      const incompleteShard = { extractReplica: vi.fn(), normalize: vi.fn() };
      (loader.load as any).mockResolvedValue(incompleteShard);
      const result = await service.prepareUpdate('salesforce', 'standard', { name: 'Test' }, '123', { etag: 'x' });
      expect(result).toEqual({ name: 'Test' });
    });

    it('rethrows generic load errors', async () => {
      const error = new Error('Syntax error');
      (loader.load as any).mockRejectedValue(error);
      await expect(service.prepareUpdate('salesforce', 'standard', { name: 'Test' }, '123', { etag: 'x' })).rejects.toThrow('Syntax error');
    });
  });

  describe('getWebhookResponse', () => {
    it('delegates to shard if method exists', async () => {
      mockShard.getWebhookResponse.mockResolvedValue({ status: 200, body: 'ok' });
      const result = await service.getWebhookResponse('salesforce', 'standard', { payload: 'foo' }, { 'x-header': 'bar' });
      expect(loader.load).toHaveBeenCalledWith('salesforce/standard');
      expect(mockShard.getWebhookResponse).toHaveBeenCalledWith({ payload: 'foo' }, { 'x-header': 'bar' });
      expect(result).toEqual({ status: 200, body: 'ok' });
    });

    it('returns null if shard is not found', async () => {
      const error = new Error('not found');
      (error as any).code = 'ENOENT';
      (loader.load as any).mockRejectedValue(error);
      const result = await service.getWebhookResponse('salesforce', 'standard', {}, {});
      expect(result).toBeNull();
    });

    it('returns null if method is omitted', async () => {
      const incompleteShard = { extractReplica: vi.fn(), normalize: vi.fn() };
      (loader.load as any).mockResolvedValue(incompleteShard);
      const result = await service.getWebhookResponse('salesforce', 'standard', {}, {});
      expect(result).toBeNull();
    });

    it('rethrows runtime errors inside the hook', async () => {
      mockShard.getWebhookResponse.mockRejectedValue(new Error('Internal hook error'));
      await expect(service.getWebhookResponse('salesforce', 'standard', {}, {})).rejects.toThrow('Internal hook error');
    });
  });

  describe('activeFetch', () => {
    it('delegates to shard if method exists', async () => {
      mockShard.activeFetch.mockResolvedValue(undefined);
      await service.activeFetch('salesforce', 'standard', [{ entityType: 'Account', sourceId: '123' }], 'ds-1');
      expect(loader.load).toHaveBeenCalledWith('salesforce/standard');
      expect(mockShard.activeFetch).toHaveBeenCalledWith([{ entityType: 'Account', sourceId: '123' }], 'ds-1');
    });

    it('returns without error if method is omitted', async () => {
      const incompleteShard = { extractReplica: vi.fn(), normalize: vi.fn() };
      (loader.load as any).mockResolvedValue(incompleteShard);
      await expect(service.activeFetch('salesforce', 'standard', [], 'ds-1')).resolves.toBeUndefined();
    });
  });

  describe('reverseLookup', () => {
    it('delegates to shard if method exists', async () => {
      mockShard.reverseLookup.mockResolvedValue(['p-1', 'p-2']);
      const result = await service.reverseLookup('salesforce', 'standard', {} as any, 'public', 'Contact', 'c-1');
      expect(loader.load).toHaveBeenCalledWith('salesforce/standard');
      expect(mockShard.reverseLookup).toHaveBeenCalledWith({}, 'public', 'Contact', 'c-1');
      expect(result).toEqual(['p-1', 'p-2']);
    });

    it('returns empty array if method is omitted', async () => {
      const incompleteShard = { extractReplica: vi.fn(), normalize: vi.fn() };
      (loader.load as any).mockResolvedValue(incompleteShard);
      const result = await service.reverseLookup('salesforce', 'standard', {} as any, 'public', 'Contact', 'c-1');
      expect(result).toEqual([]);
    });
  });
});
