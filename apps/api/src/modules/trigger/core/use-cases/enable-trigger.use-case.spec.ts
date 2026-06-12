import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EnableTriggerUseCase } from './enable-trigger.use-case.js';
import { FakeTriggerGatewayRepository } from '../fakes/fake-trigger-gateway.repository.js';
import { FakeTriggerStorageResolver } from '../fakes/fake-trigger-storage.resolver.js';
import { FakeDatabaseProvisioner } from '../fakes/fake-database-provisioner.js';
import { FakeKeyValueStore } from '../fakes/fake-key-value-store.js';
import { SchemaPlan } from '@soopa/dbmanager';
import type { Trigger } from '@soopa/piece-framework';

describe('EnableTriggerUseCase', () => {
  let fakeRepo: FakeTriggerGatewayRepository;
  let fakeResolver: FakeTriggerStorageResolver;
  let fakeProvisioner: FakeDatabaseProvisioner;
  let fakeKvStore: FakeKeyValueStore;
  let useCase: EnableTriggerUseCase;

  beforeEach(() => {
    fakeRepo = new FakeTriggerGatewayRepository();
    fakeResolver = new FakeTriggerStorageResolver();
    fakeProvisioner = new FakeDatabaseProvisioner();
    fakeKvStore = new FakeKeyValueStore();

    useCase = new EnableTriggerUseCase(
      fakeRepo,
      fakeResolver,
      fakeProvisioner,
      fakeKvStore,
    );
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
    expect(fakeProvisioner.callCount.applyPlan).toBe(1);
    expect(fakeProvisioner.appliedPlans[0].schemaPlan).toBe(
      SchemaPlan.OUTBOUND_ACTIVE,
    );
    expect(fakeProvisioner.callCount.registerPublication).toBe(1);

    expect(params.trigger.onEnable).toHaveBeenCalled();

    expect(fakeRepo.callCount.updateSchemaPlan).toBe(1);
    expect(fakeRepo.schemaPlans.get('ds-789')).toBe(SchemaPlan.OUTBOUND_ACTIVE);
  });

  it('should rollback schemaPlan and unregister publication if onEnable throws', async () => {
    const params = getParams({
      onEnable: vi.fn().mockRejectedValue(new Error('Third-party API failed')),
    });

    await expect(useCase.execute(params)).rejects.toThrow(
      'Third-party API failed',
    );

    // It should have registered the publication before calling onEnable
    expect(fakeProvisioner.callCount.registerPublication).toBe(1);

    // It should NOT have written the registry row since onEnable threw
    expect(fakeRepo.schemaPlans.get('ds-789')).toBeUndefined();

    // It SHOULD unregister the publication since it rolled back
    expect(fakeProvisioner.callCount.unregisterPublication).toBe(1);
  });

  it('should rollback schemaPlan if updateSchemaPlan throws', async () => {
    const params = getParams();

    // Simulate gatewayRepo throwing AFTER onEnable
    fakeRepo.updateSchemaPlan = vi
      .fn()
      .mockRejectedValueOnce(new Error('DB connection lost'))
      .mockResolvedValueOnce(undefined); // second call during revert succeeds

    await expect(useCase.execute(params)).rejects.toThrow('DB connection lost');

    expect(params.trigger.onEnable).toHaveBeenCalled();
    expect(fakeProvisioner.callCount.unregisterPublication).toBe(1);
  });
});
