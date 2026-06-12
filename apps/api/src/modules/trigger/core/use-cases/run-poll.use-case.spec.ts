import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RunPollUseCase } from './run-poll.use-case.js';
import { FakeTriggerGatewayRepository } from '../fakes/fake-trigger-gateway.repository.js';
import { FakeTriggerStorageResolver } from '../fakes/fake-trigger-storage.resolver.js';
import { FakeDistributedLockService } from '../fakes/fake-distributed-lock.service.js';
import { FakeKeyValueStore } from '../fakes/fake-key-value-store.js';
import { TriggerPayloadTransformer } from '../../trigger-payload-transformer.js';
import { TriggerRetryPolicyService } from '../../trigger-retry-policy.service.js';
import type { ITriggerDlqService } from '../../interfaces/trigger-dlq.interface.js';
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

describe('RunPollUseCase', () => {
  let fakeRepo: FakeTriggerGatewayRepository;
  let fakeResolver: FakeTriggerStorageResolver;
  let fakeLock: FakeDistributedLockService;
  let fakeKvStore: FakeKeyValueStore;
  let fakeDlq: FakeTriggerDlqService;
  let payloadTransformer: TriggerPayloadTransformer;
  let retryPolicy: TriggerRetryPolicyService;
  let useCase: RunPollUseCase;

  beforeEach(() => {
    fakeRepo = new FakeTriggerGatewayRepository();
    fakeResolver = new FakeTriggerStorageResolver();
    fakeLock = new FakeDistributedLockService();
    fakeKvStore = new FakeKeyValueStore();
    fakeDlq = new FakeTriggerDlqService();
    payloadTransformer = new TriggerPayloadTransformer();
    retryPolicy = new TriggerRetryPolicyService(fakeDlq);

    useCase = new RunPollUseCase(
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
      run: vi.fn().mockResolvedValue([{ id: 10 }, { id: 20 }]),
      ...triggerOverrides,
    } as any,
    appName: 'jira',
    triggerName: 'new-issue',
    objectType: undefined,
    auth: { token: '123' },
    propsValue: { project: 'NEX' },
    tenantId: 'tenant-123',
    workspaceId: 'ws-456',
    dataSourceId: 'ds-789',
    fromDlqRetry: false,
  });

  it('should bail out if poll lock is already held', async () => {
    const params = getParams();

    const lockKey = `lock:poll:${params.workspaceId}:${params.triggerName}`;
    fakeLock.holdLock(lockKey);

    await useCase.execute(params);

    expect(params.trigger.run).not.toHaveBeenCalled();
  });

  it('should execute onPoll, acquire lock, insert rows, and release lock', async () => {
    const params = getParams();

    await useCase.execute(params);

    expect(params.trigger.run).toHaveBeenCalled();
    expect(fakeRepo.callCount.insertGatewayRow).toBe(2);
    expect(fakeRepo.insertedRows.length).toBe(2);

    // The lock should have been released
    expect(fakeLock.callCount.acquireLock).toBe(1);
    expect(fakeLock.callCount.releaseLock).toBe(1);
    expect(fakeLock.locks.size).toBe(0);
  });

  it('should deduct deduplication logic accurately (skip inserting duplicate rows)', async () => {
    const params = getParams();

    // Simulate gateway returning false for the first record (conflict/duplicate)
    // and true for the second record
    let callIndex = 0;
    fakeRepo.insertGatewayRow = vi.fn().mockImplementation(() => {
      callIndex++;
      return Promise.resolve(callIndex === 2);
    });

    await useCase.execute(params);

    // It should still process all records, but our mock simulating duplicate
    // simply returns false and the loop continues
    expect(fakeRepo.insertGatewayRow).toHaveBeenCalledTimes(2);
  });

  it('should push to DLQ and return gracefully if run fails', async () => {
    const params = getParams({
      run: vi.fn().mockRejectedValue(new Error('Jira API timeout')),
    });

    await useCase.execute(params);

    expect(fakeDlq.jobs.length).toBe(1);
    expect(fakeLock.callCount.releaseLock).toBe(1);
  });
});
