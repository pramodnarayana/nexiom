import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EnableTriggerUseCase } from './enable-trigger.use-case.js';
import { FakeTriggerStorageResolver } from '../fakes/trigger-storage-resolver.fake.js';
import { FakeKeyValueStore } from '../fakes/key-value-store.fake.js';
import type { Trigger } from '@soopa/piece-framework';

describe('EnableTriggerUseCase', () => {
  let fakeResolver: FakeTriggerStorageResolver;
  let fakeKvStore: FakeKeyValueStore;
  let useCase: EnableTriggerUseCase;

  beforeEach(() => {
    fakeResolver = new FakeTriggerStorageResolver();
    fakeKvStore = new FakeKeyValueStore();

    useCase = new EnableTriggerUseCase(fakeResolver, fakeKvStore);
  });

  const getParams = (triggerOverrides: Partial<Trigger> = {}) => ({
    trigger: {
      onEnable: vi.fn().mockResolvedValue(undefined),
      ...triggerOverrides,
    } as any,
    appName: 'salesforce',
    triggerName: 'new-lead',
    objectType: undefined,
    auth: { token: '123' },
    propsValue: { foo: 'bar' },
    tenantId: 'tenant-123',
    workspaceId: 'ws-456',
    dataSourceId: 'ds-789',
    appProfile: 'default',
  });

  it('should enable trigger successfully', async () => {
    const params = getParams();

    await useCase.execute(params);

    expect(fakeResolver.callCount.resolveSchemaName).toBe(1);
    expect(params.trigger.onEnable).toHaveBeenCalled();
  });

  it('should propagate errors if onEnable throws', async () => {
    const params = getParams({
      onEnable: vi.fn().mockRejectedValue(new Error('Third-party API failed')),
    });

    await expect(useCase.execute(params)).rejects.toThrow(
      'Third-party API failed',
    );
  });
});
