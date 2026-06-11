import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RunWebhookUseCase } from './run-webhook.use-case.js';
import { FakeTriggerGatewayRepository } from '../fakes/fake-trigger-gateway.repository.js';
import { FakeTriggerStorageResolver } from '../fakes/fake-trigger-storage.resolver.js';
import { FakeDistributedLockService } from '../fakes/fake-distributed-lock.service.js';
import { FakeKeyValueStore } from '../fakes/fake-key-value-store.js';
import { TriggerPayloadTransformer } from '../../trigger-payload-transformer.js';
import { TriggerRetryPolicyService } from '../../trigger-retry-policy.service.js';
import type { ITriggerDlqService } from '../../interfaces/trigger-dlq.interface.js';
import { UnauthorizedException } from '@nestjs/common';
import type { Trigger } from '@soopa/piece-framework';

class FakeTriggerDlqService implements ITriggerDlqService {
  public jobs: string[] = [];
  pushJob(jobData: string): Promise<void> {
    this.jobs.push(jobData);
    return Promise.resolve();
  }
  promoteDelayedJobs(_batchSize: number): Promise<number> {
    return Promise.resolve(0);
  }
  reclaimStaleJobs(_staleMs: number, _batchSize: number): Promise<number> {
    return Promise.resolve(0);
  }
  drainReadyJobs(
    _batchSize: number,
    _handler: (raw: string) => Promise<void>,
  ): Promise<void> {
    return Promise.resolve();
  }
  scheduleDelayedRetry(
    _raw: string,
    _retryPayload: string,
    _delayMs: number,
  ): Promise<void> {
    return Promise.resolve();
  }
  markJobFailed(_raw: string, _failedPayload: string): Promise<void> {
    return Promise.resolve();
  }
  acknowledgeJob(_raw: string): Promise<void> {
    return Promise.resolve();
  }
  removeUnparseableJob(_raw: string): Promise<void> {
    return Promise.resolve();
  }
}

describe('RunWebhookUseCase', () => {
  let fakeRepo: FakeTriggerGatewayRepository;
  let fakeResolver: FakeTriggerStorageResolver;
  let fakeLock: FakeDistributedLockService;
  let fakeKvStore: FakeKeyValueStore;
  let fakeDlq: FakeTriggerDlqService;
  let payloadTransformer: TriggerPayloadTransformer;
  let retryPolicy: TriggerRetryPolicyService;
  let useCase: RunWebhookUseCase;

  beforeEach(() => {
    fakeRepo = new FakeTriggerGatewayRepository();
    fakeResolver = new FakeTriggerStorageResolver();
    fakeLock = new FakeDistributedLockService();
    fakeKvStore = new FakeKeyValueStore();
    fakeDlq = new FakeTriggerDlqService();
    payloadTransformer = new TriggerPayloadTransformer();
    retryPolicy = new TriggerRetryPolicyService(fakeDlq);

    useCase = new RunWebhookUseCase(
      fakeRepo,
      fakeResolver,
      fakeLock,
      retryPolicy,
      payloadTransformer,
      fakeKvStore,
    );
  });

  const getParams = (triggerOverrides: Partial<Trigger> = {}) => ({
    trigger: {
      run: vi.fn().mockResolvedValue([{ id: 1 }, { id: 2 }]),
      ...triggerOverrides,
    } as any,
    appName: 'github',
    triggerName: 'new-issue',
    objectType: undefined,
    auth: { token: '123' },
    propsValue: { repo: 'nexiom' },
    headers: { 'x-hub-signature': 'sig' },
    rawBody: Buffer.from('{"id":1}'),
    secret: 'my-secret',
    tenantId: 'tenant-123',
    workspaceId: 'ws-456',
    dataSourceId: 'ds-789',
    fromDlqRetry: false,
  });

  it('should validate signature and throw UnauthorizedException if invalid', async () => {
    const params = getParams({
      verifySignature: vi.fn().mockImplementation(() => {
        throw new Error('Invalid signature');
      }),
    });

    await expect(useCase.execute(params)).rejects.toThrow(
      UnauthorizedException,
    );
    expect(params.trigger.verifySignature).toHaveBeenCalledWith(
      params.headers,
      params.rawBody,
      params.secret,
    );
  });

  it('should bail out if lock is already held', async () => {
    const params = getParams();

    // Calculate the hash that will be generated to hold it pre-emptively
    const bodyHash = payloadTransformer.buildWebhookLockHash(params.rawBody);
    const lockKey = `lock:webhook:${params.workspaceId}:${params.triggerName}:${bodyHash}`;

    fakeLock.holdLock(lockKey);

    await useCase.execute(params);

    // trigger.run should not be called because we bailed out
    expect(params.trigger.run).not.toHaveBeenCalled();
  });

  it('should run trigger, acquire lock, insert rows, and release lock', async () => {
    const params = getParams();

    await useCase.execute(params);

    expect(params.trigger.run).toHaveBeenCalled();
    expect(fakeRepo.callCount.insertGatewayRow).toBe(2); // two records returned from run()
    expect(fakeRepo.insertedRows.length).toBe(2);

    // The lock should have been released
    expect(fakeLock.callCount.acquireLock).toBe(1);
    expect(fakeLock.callCount.releaseLock).toBe(1);
    expect(fakeLock.locks.size).toBe(0);
  });

  it('should push to DLQ and return gracefully if trigger.run fails', async () => {
    const params = getParams({
      run: vi.fn().mockRejectedValue(new Error('API rate limit')),
    });

    await useCase.execute(params);

    expect(fakeDlq.jobs.length).toBe(1);
    expect(fakeLock.callCount.releaseLock).toBe(1); // lock must still be released in finally block
  });
});
