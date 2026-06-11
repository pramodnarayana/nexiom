import { describe, it, expect, vi, beforeEach, Mocked } from 'vitest';
import { TargetBuilderService } from './target-builder.service.js';
import { PipelineHookBrokerService } from '../sharding/pipeline-hook-broker.service.js';

describe('TargetBuilderService', () => {
  let db: any;
  let hookBroker: Mocked<PipelineHookBrokerService>;
  let service: TargetBuilderService;

  beforeEach(() => {
    db = {};
    hookBroker = { buildTarget: vi.fn() } as any;

    service = new TargetBuilderService(db, hookBroker);
  });

  const rules = [
    { src: 'first_name', dest: 'name' } as any
  ];

  it('throws error if no rules are configured', async () => {
    await expect(service.buildPayload('ws_1', 'salesforce', 'standard', 'Customer', 'id-1', {}, []))
      .rejects.toThrow('No mapping rules configured for Customer. Please configure field mappings for this integration before syncing.');
  });

  it('throws error if hydrated payload is empty', async () => {
    await expect(service.buildPayload('ws_1', 'salesforce', 'standard', 'Customer', 'id-1', {}, rules))
      .rejects.toThrow('Mapping rules failed to produce a valid payload for Customer. Check your field mapping configuration.');
  });

  it('builds payload successfully using normalizedData if hook returns empty', async () => {
    hookBroker.buildTarget.mockResolvedValue({});

    const normalizedData = { first_name: 'John' };
    const res = await service.buildPayload('ws_1', 'salesforce', 'standard', 'Customer', 'id-1', normalizedData, rules);

    expect(hookBroker.buildTarget).toHaveBeenCalledWith('salesforce', 'standard', db, 'ws_1', 'Customer', 'id-1');
    expect(res).toEqual({ name: 'John' });
  });

  it('enriches context with hook results if buildTarget returns data', async () => {
    hookBroker.buildTarget.mockResolvedValue({ last_name: 'Doe' });

    const rulesWithEnrichment = [
      { src: 'first_name', dest: 'name' } as any,
      { src: 'last_name', dest: 'surname' } as any
    ];

    const normalizedData = { first_name: 'John' };
    const res = await service.buildPayload('ws_1', 'salesforce', 'standard', 'Customer', 'id-1', normalizedData, rulesWithEnrichment);

    expect(res).toEqual({ name: 'John', surname: 'Doe' });
  });

  it('falls back to normalizedData if hook throws an error', async () => {
    hookBroker.buildTarget.mockRejectedValue(new Error('Hook failed'));

    const normalizedData = { first_name: 'John' };
    const res = await service.buildPayload('ws_1', 'salesforce', 'standard', 'Customer', 'id-1', normalizedData, rules);

    expect(res).toEqual({ name: 'John' });
  });

  it('skips enrichment if srcEntityId is undefined', async () => {
    const normalizedData = { first_name: 'John' };
    const res = await service.buildPayload('ws_1', 'salesforce', 'standard', 'Customer', undefined, normalizedData, rules);

    expect(hookBroker.buildTarget).not.toHaveBeenCalled();
    expect(res).toEqual({ name: 'John' });
  });
});
