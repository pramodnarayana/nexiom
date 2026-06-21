import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PipelineHookBrokerService } from './pipeline-hook-broker.service.js';

describe('PipelineHookBrokerService', () => {
  let service: PipelineHookBrokerService;
  let mockPieceRegistry: any;
  let mockHooks: any;

  beforeEach(() => {
    mockHooks = {
      extractReplica: vi.fn(),
      normalize: vi.fn(),
      writeNormalized: vi.fn(),
      buildTarget: vi.fn(),
      provisionDomain: vi.fn(),
    };
    
    mockPieceRegistry = {
      getPiece: vi.fn().mockReturnValue({ appHooks: mockHooks }),
    };

    service = new PipelineHookBrokerService(mockPieceRegistry);
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('extractReplica', () => {
    it('calls the registered extractor and returns its result', async () => {
      const extractor = vi.fn().mockReturnValue({ entityType: 'contact', data: {} });
      mockHooks.extractReplica = extractor;

      const result = await service.extractReplica('salesforce', 'standard', { foo: 'bar' });

      expect(extractor).toHaveBeenCalledWith({ foo: 'bar' }, undefined);
      expect(result).toEqual({ entityType: 'contact', data: {} });
    });

    it('throws if no extractor is registered', async () => {
      mockHooks.extractReplica = undefined;

      await expect(service.extractReplica('salesforce', 'standard', {}))
        .rejects.toThrow('extractReplica hook not implemented by piece: salesforce');
    });
  });

  describe('normalize', () => {
    it('calls the registered normalizer and returns its result', async () => {
      const normalizer = vi.fn().mockReturnValue([{ entityType: 'Contact', data: {} }]);
      mockHooks.normalize = normalizer;

      const replica = { entityType: 'contact', data: { id: '1' } };
      const result = await service.normalize('salesforce', 'standard', replica);

      expect(normalizer).toHaveBeenCalledWith(replica);
      expect(result).toEqual([{ entityType: 'Contact', data: {} }]);
    });

    it('returns null if no normalizer is registered', async () => {
      mockHooks.normalize = undefined;

      const result = await service.normalize('salesforce', 'standard', { entityType: 'Account', data: {} });
      expect(result).toBeNull();
    });
  });

  describe('writeNormalized', () => {
    it('calls the registered writer', async () => {
      const writer = vi.fn().mockResolvedValue(undefined);
      mockHooks.writeNormalized = writer;

      await service.writeNormalized('salesforce', 'standard', {}, {} as any, 'public', 'r-1', 'e-1', 't-1', 'd-1', 'Contact', { foo: 'bar' });

      expect(writer).toHaveBeenCalledWith({}, {}, 'public', 'r-1', 'e-1', 't-1', 'd-1', 'Contact', { foo: 'bar' });
    });

    it('throws if no writer is registered', async () => {
      mockHooks.writeNormalized = undefined;

      await expect(service.writeNormalized('salesforce', 'standard', {}, {} as any, 'public', 'r-1', 'e-1', 't-1', 'd-1', 'Contact', {}))
        .rejects.toThrow('writeNormalized hook not implemented by piece: salesforce');
    });
  });

  describe('buildTarget', () => {
    it('calls the registered builder and returns its result', async () => {
      const builder = vi.fn().mockResolvedValue({ mappedId: '123' });
      mockHooks.buildTarget = builder;

      const result = await service.buildTarget('salesforce', 'standard', {} as any, 'public', 'Contact', 'src-1');

      expect(builder).toHaveBeenCalledWith({}, 'public', 'Contact', 'src-1');
      expect(result).toEqual({ mappedId: '123' });
    });

    it('throws if no builder is registered', async () => {
      mockHooks.buildTarget = undefined;

      await expect(service.buildTarget('salesforce', 'standard', {} as any, 'public', 'Contact', 'src-1'))
        .rejects.toThrow('buildTarget hook not implemented by piece: salesforce');
    });
  });

  describe('provisionDomain', () => {
    it('calls the registered provisioner', async () => {
      const provisioner = vi.fn().mockResolvedValue(undefined);
      mockHooks.provisionDomain = provisioner;

      await service.provisionDomain('salesforce', 'standard', {} as any, 'public');

      expect(provisioner).toHaveBeenCalledWith({}, 'public');
    });

    it('skips silently if no provisioner is registered', async () => {
      mockHooks.provisionDomain = undefined;

      await expect(service.provisionDomain('salesforce', 'standard', {} as any, 'public'))
        .resolves.toBeUndefined();
    });
  });

  describe('prepareUpdate', () => {
    it('returns the original payload (not yet implemented via hooks)', async () => {
      const payload = { name: 'Test' };
      const result = await service.prepareUpdate('salesforce', 'standard', payload, '123', { etag: 'x' });
      expect(result).toEqual(payload);
    });
  });

  describe('getWebhookResponse', () => {
    it('returns the webhook response from getWebhookResponse hook', async () => {
      mockHooks.getWebhookResponse = vi.fn().mockReturnValue({ status: 200, body: 'ok' });

      const result = await service.getWebhookResponse('salesforce', 'standard', { payload: 'foo' }, { 'x-header': 'bar' });

      expect(mockHooks.getWebhookResponse).toHaveBeenCalledWith({ payload: 'foo' }, { 'x-header': 'bar' });
      expect(result).toEqual({ status: 200, body: 'ok' });
    });

    it('returns null if no webhook response is found', async () => {
      mockHooks.getWebhookResponse = undefined;

      const result = await service.getWebhookResponse('salesforce', 'standard', {}, {});
      expect(result).toBeNull();
    });
  });

  describe('activeFetch', () => {
    it('throws error for fail-closed behavior (not yet implemented via hooks)', async () => {
      await expect(
        service.activeFetch('salesforce', 'standard', [{ entityType: 'Account', sourceId: '123' }], 'ds-1')
      ).rejects.toThrow('[PipelineHookBroker] activeFetch hook is not implemented by piece: salesforce');
    });
  });

  describe('reverseLookup', () => {
    it('returns empty array (not yet implemented via hooks)', async () => {
      const result = await service.reverseLookup('salesforce', 'standard', {} as any, 'public', 'Contact', 'c-1');
      expect(result).toEqual([]);
    });
  });
});
