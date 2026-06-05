import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DlqProcessorService } from './dlq-processor.service.js';
/* eslint-disable @typescript-eslint/unbound-method */
import { TriggerStrategy } from '@soopa/piece-framework';
import type { TriggerExecutorService } from './trigger-executor.service.js';
import { PieceRegistryService } from '@soopa/piece-registry';
import { ITriggerDlqService } from './interfaces/trigger-dlq.interface.js';

function makeMockDlqService() {
  return {
    pushJob: vi.fn().mockResolvedValue(undefined),
    promoteDelayedJobs: vi.fn().mockResolvedValue(0),
    reclaimStaleJobs: vi.fn().mockResolvedValue(0),
    drainReadyJobs: vi.fn().mockResolvedValue(undefined),
    scheduleDelayedRetry: vi.fn().mockResolvedValue(undefined),
    markJobFailed: vi.fn().mockResolvedValue(undefined),
    acknowledgeJob: vi.fn().mockResolvedValue(undefined),
    removeUnparseableJob: vi.fn().mockResolvedValue(undefined),
  };
}

function makeExecutor(returnValue = true) {
  return {
    runPoll: vi.fn().mockResolvedValue(returnValue),
  } as unknown as TriggerExecutorService;
}

function makeRegistry(found = true) {
  return {
    getTrigger: vi
      .fn()
      .mockReturnValue(
        found
          ? { name: 'new_record', type: TriggerStrategy.POLLING }
          : undefined,
      ),
  } as unknown as PieceRegistryService;
}

const baseJob = {
  appName: 'salesforce',
  triggerName: 'new_record',
  workspaceId: 'ws_1',
  propsValue: {},
  auth: {},
  failedAt: '2023-01-01T00:00:00.000Z',
  error: 'timeout',
  attempt: 1,
};

describe('DlqProcessorService', () => {
  let dlqService: ReturnType<typeof makeMockDlqService>;
  let executor: TriggerExecutorService;
  let registry: PieceRegistryService;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('should do nothing when DLQ is empty', async () => {
    dlqService = makeMockDlqService();
    executor = makeExecutor();
    registry = makeRegistry();

    const service = new DlqProcessorService(
      dlqService as unknown as ITriggerDlqService,
      executor,
      registry,
    );

    await service.processDlq();

    expect(dlqService.promoteDelayedJobs).toHaveBeenCalled();
    expect(dlqService.reclaimStaleJobs).toHaveBeenCalled();
    expect(dlqService.drainReadyJobs).toHaveBeenCalled();
    expect(executor.runPoll).not.toHaveBeenCalled();
  });

  it('should retry a valid job via executor.runPoll', async () => {
    dlqService = makeMockDlqService();
    executor = makeExecutor(true);
    registry = makeRegistry();

    // Simulate drainReadyJobs yielding one job
    dlqService.drainReadyJobs.mockImplementation(
      async (_batchSize, handler: (job: string) => Promise<void>) => {
        await handler(JSON.stringify(baseJob));
      },
    );

    const service = new DlqProcessorService(
      dlqService as unknown as ITriggerDlqService,
      executor,
      registry,
    );

    await service.processDlq();

    expect(executor.runPoll).toHaveBeenCalledOnce();
    // Job should be acked from processing list on success
    expect(dlqService.acknowledgeJob).toHaveBeenCalled();
  });

  it('should reclaim stale jobs', async () => {
    dlqService = makeMockDlqService();
    executor = makeExecutor(true);
    registry = makeRegistry();

    dlqService.reclaimStaleJobs.mockResolvedValue(1);

    const service = new DlqProcessorService(
      dlqService as unknown as ITriggerDlqService,
      executor,
      registry,
    );

    await service.processDlq();

    expect(dlqService.reclaimStaleJobs).toHaveBeenCalledWith(
      10 * 60 * 1000,
      expect.any(Number),
    );
  });

  it('should defer job to delayed sorted-set when lock is held (runPoll=false)', async () => {
    dlqService = makeMockDlqService();
    executor = makeExecutor(false); // lock contention
    registry = makeRegistry();

    dlqService.drainReadyJobs.mockImplementation(
      async (_batchSize, handler: (job: string) => Promise<void>) => {
        await handler(JSON.stringify(baseJob));
      },
    );

    const service = new DlqProcessorService(
      dlqService as unknown as ITriggerDlqService,
      executor,
      registry,
    );

    await service.processDlq();

    // Job must be scheduled in the delayed set
    expect(dlqService.scheduleDelayedRetry).toHaveBeenCalledWith(
      expect.any(String), // raw string
      expect.stringContaining('"appName":"salesforce"'), // new payload
      expect.any(Number), // delayMs
    );
    expect(dlqService.pushJob).not.toHaveBeenCalled();
  });

  it('should discard unparseable jobs and log a fingerprint (not the raw payload)', async () => {
    dlqService = makeMockDlqService();
    executor = makeExecutor();
    registry = makeRegistry();

    dlqService.drainReadyJobs.mockImplementation(
      async (_batchSize, handler: (job: string) => Promise<void>) => {
        await handler('not-valid-json{{{');
      },
    );

    const service = new DlqProcessorService(
      dlqService as unknown as ITriggerDlqService,
      executor,
      registry,
    );

    await service.processDlq();

    expect(executor.runPoll).not.toHaveBeenCalled();
    // Job must be removed from processing list
    expect(dlqService.removeUnparseableJob).toHaveBeenCalled();
  });

  it('should discard job if trigger is not found in registry', async () => {
    dlqService = makeMockDlqService();
    executor = makeExecutor();
    registry = makeRegistry(false); // trigger not found

    dlqService.drainReadyJobs.mockImplementation(
      async (_batchSize, handler: (job: string) => Promise<void>) => {
        await handler(JSON.stringify(baseJob));
      },
    );

    const service = new DlqProcessorService(
      dlqService as unknown as ITriggerDlqService,
      executor,
      registry,
    );

    await service.processDlq();

    expect(executor.runPoll).not.toHaveBeenCalled();
    expect(dlqService.acknowledgeJob).toHaveBeenCalled(); // acked/discarded
  });

  it('should schedule a delayed retry when runPoll throws and attempts remain', async () => {
    dlqService = makeMockDlqService();
    const failingExecutor = {
      runPoll: vi.fn().mockRejectedValue(new Error('retry me')),
    } as unknown as TriggerExecutorService;
    registry = makeRegistry();

    dlqService.drainReadyJobs.mockImplementation(
      async (_batchSize, handler: (job: string) => Promise<void>) => {
        await handler(JSON.stringify({ ...baseJob, attempt: 1 }));
      },
    );

    const service = new DlqProcessorService(
      dlqService as unknown as ITriggerDlqService,
      failingExecutor,
      registry,
    );

    await service.processDlq();

    // Must be scheduled into delayed sorted set
    expect(dlqService.scheduleDelayedRetry).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining('"attempt":2'),
      expect.any(Number),
    );
    expect(dlqService.markJobFailed).not.toHaveBeenCalled();
  });

  it('should move to failed list after MAX_ATTEMPTS exhausted', async () => {
    dlqService = makeMockDlqService();
    const failingExecutor = {
      run反Poll: vi.fn().mockRejectedValue(new Error('permanent fail')),
      runPoll: vi.fn().mockRejectedValue(new Error('permanent fail')),
    } as unknown as TriggerExecutorService;
    registry = makeRegistry();

    // attempt: 3 means next attempt (4) hits the limit (MAX_ATTEMPTS=3)
    dlqService.drainReadyJobs.mockImplementation(
      async (_batchSize, handler: (job: string) => Promise<void>) => {
        await handler(JSON.stringify({ ...baseJob, attempt: 3 }));
      },
    );

    const service = new DlqProcessorService(
      dlqService as unknown as ITriggerDlqService,
      failingExecutor,
      registry,
    );

    await service.processDlq();

    expect(dlqService.markJobFailed).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining('exhaustedAt'),
    );
  });

  it('should promote delayed jobs that are due back into the ready queue', async () => {
    dlqService = makeMockDlqService();
    executor = makeExecutor();
    registry = makeRegistry();

    dlqService.promoteDelayedJobs.mockResolvedValue(1);

    const service = new DlqProcessorService(
      dlqService as unknown as ITriggerDlqService,
      executor,
      registry,
    );

    await service.processDlq();

    expect(dlqService.promoteDelayedJobs).toHaveBeenCalledWith(
      expect.any(Number), // BATCH_SIZE
    );
  });
});
