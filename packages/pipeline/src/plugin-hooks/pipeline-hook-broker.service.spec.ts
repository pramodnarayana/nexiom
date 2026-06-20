import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PipelineHookBrokerService } from './pipeline-hook-broker.service.js';

// Mock the piece-framework hook registries
vi.mock('@soopa/piece-framework', async () => {
  const actual = await vi.importActual<typeof import('@soopa/piece-framework')>('@soopa/piece-framework');
  return {
    ...actual,
    getReplicaExtractor: vi.fn(),
    getNormalizer: vi.fn(),
    getNormalizedWriter: vi.fn(),
    getTargetBuilder: vi.fn(),
    getDomainProvisioner: vi.fn(),
    executeAppWebhookResponses: vi.fn(),
  };
});

import {
  getReplicaExtractor,
  getNormalizer,
  getNormalizedWriter,
  getTargetBuilder,
  getDomainProvisioner,
  executeAppWebhookResponses,
} from '@soopa/piece-framework';

describe('PipelineHookBrokerService', () => {
  let service: PipelineHookBrokerService;

  beforeEach(() => {
    service = new PipelineHookBrokerService();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('extractReplica', () => {
    it('calls the registered extractor and returns its result', async () => {
      const extractor = vi.fn().mockReturnValue({ entityType: 'contact', data: {} });
      vi.mocked(getReplicaExtractor).mockReturnValue(extractor);

      const result = await service.extractReplica('salesforce', 'standard', { foo: 'bar' });

      expect(getReplicaExtractor).toHaveBeenCalledWith('salesforce', 'standard');
      expect(extractor).toHaveBeenCalledWith({ foo: 'bar' });
      expect(result).toEqual({ entityType: 'contact', data: {} });
    });

    it('throws if no extractor is registered', async () => {
      vi.mocked(getReplicaExtractor).mockReturnValue(undefined);

      await expect(service.extractReplica('salesforce', 'standard', {}))
        .rejects.toThrow('extractReplica hook not registered for piece: salesforce');
    });
  });

  describe('normalize', () => {
    it('calls the registered normalizer and returns its result', async () => {
      const normalizer = vi.fn().mockReturnValue([{ entityType: 'Contact', data: {} }]);
      vi.mocked(getNormalizer).mockReturnValue(normalizer);

      const replica = { entityType: 'contact', data: { id: '1' } };
      const result = await service.normalize('salesforce', 'standard', replica);

      expect(getNormalizer).toHaveBeenCalledWith('salesforce', 'standard');
      expect(normalizer).toHaveBeenCalledWith(replica);
      expect(result).toEqual([{ entityType: 'Contact', data: {} }]);
    });

    it('returns null if no normalizer is registered', async () => {
      vi.mocked(getNormalizer).mockReturnValue(undefined);

      const result = await service.normalize('salesforce', 'standard', { entityType: 'Account', data: {} });
      expect(result).toBeNull();
    });
  });

  describe('writeNormalized', () => {
    it('calls the registered writer', async () => {
      const writer = vi.fn().mockResolvedValue(undefined);
      vi.mocked(getNormalizedWriter).mockReturnValue(writer);

      await service.writeNormalized('salesforce', 'standard', {}, {} as any, 'public', 'r-1', 'e-1', 't-1', 'Contact', { foo: 'bar' });

      expect(getNormalizedWriter).toHaveBeenCalledWith('salesforce', 'standard');
      expect(writer).toHaveBeenCalledWith({}, {}, 'public', 'r-1', 'e-1', 't-1', 'Contact', { foo: 'bar' });
    });

    it('throws if no writer is registered', async () => {
      vi.mocked(getNormalizedWriter).mockReturnValue(undefined);

      await expect(service.writeNormalized('salesforce', 'standard', {}, {} as any, 'public', 'r-1', 'e-1', 't-1', 'Contact', {}))
        .rejects.toThrow('writeNormalized hook not registered for piece: salesforce');
    });
  });

  describe('buildTarget', () => {
    it('calls the registered builder and returns its result', async () => {
      const builder = vi.fn().mockResolvedValue({ mappedId: '123' });
      vi.mocked(getTargetBuilder).mockReturnValue(builder);

      const result = await service.buildTarget('salesforce', 'standard', {} as any, 'public', 'Contact', 'src-1');

      expect(getTargetBuilder).toHaveBeenCalledWith('salesforce', 'standard');
      expect(builder).toHaveBeenCalledWith({}, 'public', 'Contact', 'src-1');
      expect(result).toEqual({ mappedId: '123' });
    });

    it('throws if no builder is registered', async () => {
      vi.mocked(getTargetBuilder).mockReturnValue(undefined);

      await expect(service.buildTarget('salesforce', 'standard', {} as any, 'public', 'Contact', 'src-1'))
        .rejects.toThrow('buildTarget hook not registered for piece: salesforce');
    });
  });

  describe('provisionDomain', () => {
    it('calls the registered provisioner', async () => {
      const provisioner = vi.fn().mockResolvedValue(undefined);
      vi.mocked(getDomainProvisioner).mockReturnValue(provisioner);

      await service.provisionDomain('salesforce', 'standard', {} as any, 'public');

      expect(getDomainProvisioner).toHaveBeenCalledWith('salesforce');
      expect(provisioner).toHaveBeenCalledWith({}, 'public');
    });

    it('skips silently if no provisioner is registered', async () => {
      vi.mocked(getDomainProvisioner).mockReturnValue(undefined);

      await expect(service.provisionDomain('salesforce', 'standard', {} as any, 'public'))
        .resolves.toBeUndefined();
    });
  });

  describe('prepareUpdate', () => {
    it('throws error for fail-closed behavior (not yet implemented via hooks)', async () => {
      const payload = { name: 'Test' };
      await expect(service.prepareUpdate('salesforce', 'standard', payload, '123', { etag: 'x' }))
        .rejects.toThrow('prepareUpdate hook is not implemented for salesforce:standard');
    });
  });

  describe('getWebhookResponse', () => {
    it('returns the webhook response from executeAppWebhookResponses', async () => {
      vi.mocked(executeAppWebhookResponses).mockReturnValue({ status: 200, body: 'ok' } as any);

      const result = await service.getWebhookResponse('salesforce', 'standard', { payload: 'foo' }, { 'x-header': 'bar' });

      expect(executeAppWebhookResponses).toHaveBeenCalledWith({ payload: 'foo' }, { 'x-header': 'bar' });
      expect(result).toEqual({ status: 200, body: 'ok' });
    });

    it('returns null if no webhook response is found', async () => {
      vi.mocked(executeAppWebhookResponses).mockReturnValue(undefined as any);

      const result = await service.getWebhookResponse('salesforce', 'standard', {}, {});
      expect(result).toBeNull();
    });
  });

  describe('activeFetch', () => {
    it('throws error for fail-closed behavior (not yet implemented via hooks)', async () => {
      await expect(
        service.activeFetch('salesforce', 'standard', [{ entityType: 'Account', sourceId: '123' }], 'ds-1')
      ).rejects.toThrow('activeFetch hook is not implemented for salesforce:standard');
    });
  });

  describe('reverseLookup', () => {
    it('returns empty array (not yet implemented via hooks)', async () => {
      const result = await service.reverseLookup('salesforce', 'standard', {} as any, 'public', 'Contact', 'c-1');
      expect(result).toEqual([]);
    });
  });
});
