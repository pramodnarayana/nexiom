import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DlqProcessorService } from './dlq-processor.service.js';
/* eslint-disable @typescript-eslint/unbound-method */
import { TriggerStrategy } from '@nexiom/piece-framework';
import type { TriggerExecutorService } from './trigger-executor.service.js';
import { PieceRegistryService } from '@nexiom/piece-registry';

/**
 * Minimal Redis mock that supports the DLQ surface:
 *   eval (Lua), pipeline, rpoplpush, lrem, lpush, zadd
 */
function makeRedis() {
  const pipeline = {
    zadd: vi.fn().mockReturnThis(),
    lpush: vi.fn().mockReturnThis(),
    exec: vi.fn().mockResolvedValue([]),
  };

  return {
    // delayed-set promotion (Lua eval)
    eval: vi.fn().mockResolvedValue([]), // returns [member, member, ...]
    pipeline: vi.fn().mockReturnValue(pipeline),
    // ready-queue drain (atomic pop)
    rpoplpush: vi.fn().mockResolvedValue(null),
    // ack / requeue
    lrem: vi.fn().mockResolvedValue(1),
    lpush: vi.fn().mockResolvedValue(1),
    zadd: vi.fn().mockResolvedValue(1),
    _pipeline: pipeline,
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
  let redis: ReturnType<typeof makeRedis>;
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
    redis = makeRedis();
    executor = makeExecutor();
    registry = makeRegistry();
    // promote=0, reclaim=0, drain=null
    redis.eval
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(null);

    const service = new DlqProcessorService(
      redis as unknown as import('ioredis').Redis,
      executor,
      registry,
    );

    await service.processDlq();

    expect(executor.runPoll).not.toHaveBeenCalled();
  });

  it('should retry a valid job via executor.runPoll', async () => {
    redis = makeRedis();
    executor = makeExecutor(true);
    registry = makeRegistry();
    // promote=0, reclaim=0, drain=job
    redis.eval
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(JSON.stringify(baseJob))
      .mockResolvedValue(null);

    const service = new DlqProcessorService(
      redis as unknown as import('ioredis').Redis,
      executor,
      registry,
    );

    await service.processDlq();

    expect(executor.runPoll).toHaveBeenCalledOnce();
    // Job should be acked from processing list on success
    expect(redis.lrem).toHaveBeenCalled();
  });

  it('should reclaim stale jobs from processing list back to DLQ_KEY', async () => {
    redis = makeRedis();
    executor = makeExecutor(true);
    registry = makeRegistry();

    // The first eval handles `promoteDelayedJobs` (return 0)
    redis.eval.mockResolvedValueOnce(0);
    // The second eval handles `reclaimStaleProcessingJobs` (LUA_RECLAIM returns 1 for stale)
    // It loops up to BATCH_SIZE until it returns 0
    redis.eval.mockResolvedValueOnce(1).mockResolvedValueOnce(0);
    // The next eval is `drainReadyJobs`
    redis.eval.mockResolvedValueOnce(null);

    const service = new DlqProcessorService(
      redis as unknown as import('ioredis').Redis,
      executor,
      registry,
    );

    // Call processDlq (which calls promote, reclaim, drain)
    await service.processDlq();

    // Verify LUA_RECLAIM was executed with correct keys
    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining('RPOPLPUSH'),
      2,
      'dlq:triggers:processing',
      'dlq:triggers',
      expect.any(String), // staleThreshold ARGV
    );
  });

  it('should defer job to delayed sorted-set (not immediate lpush) when lock is held (runPoll=false)', async () => {
    redis = makeRedis();
    executor = makeExecutor(false); // lock contention
    registry = makeRegistry();
    // promote=0, reclaim=0, drain=job
    redis.eval
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(JSON.stringify(baseJob))
      .mockResolvedValue(null);

    const service = new DlqProcessorService(
      redis as unknown as import('ioredis').Redis,
      executor,
      registry,
    );

    await service.processDlq();

    // Job must be scheduled in the delayed set (not immediately re-queued to DLQ_KEY)
    // so drainReadyJobs cannot hot-loop on it within the same cron pass.
    expect(redis.zadd).toHaveBeenCalledWith(
      'dlq:triggers:delayed',
      expect.any(Number), // score = Date.now() + delay
      expect.stringContaining('"appName":"salesforce"'), // payload contains job data
    );
    // Must NOT lpush directly onto the ready queue
    expect(redis.lpush).not.toHaveBeenCalledWith(
      'dlq:triggers',
      expect.anything(),
    );
  });

  it('should discard unparseable jobs and log a fingerprint (not the raw payload)', async () => {
    redis = makeRedis();
    executor = makeExecutor();
    registry = makeRegistry();
    // promote=0, reclaim=0, drain=bad json
    redis.eval
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce('not-valid-json{{{')
      .mockResolvedValue(null);

    const service = new DlqProcessorService(
      redis as unknown as import('ioredis').Redis,
      executor,
      registry,
    );

    await service.processDlq();

    expect(executor.runPoll).not.toHaveBeenCalled();
    // Job must be removed from processing list
    expect(redis.lrem).toHaveBeenCalled();
  });

  it('should discard job if trigger is not found in registry', async () => {
    redis = makeRedis();
    executor = makeExecutor();
    registry = makeRegistry(false); // trigger not found
    // promote=0, reclaim=0, drain=job
    redis.eval
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(JSON.stringify(baseJob))
      .mockResolvedValue(null);

    const service = new DlqProcessorService(
      redis as unknown as import('ioredis').Redis,
      executor,
      registry,
    );

    await service.processDlq();

    expect(executor.runPoll).not.toHaveBeenCalled();
    expect(redis.lrem).toHaveBeenCalled();
  });

  it('should schedule a delayed retry when runPoll throws and attempts remain', async () => {
    redis = makeRedis();
    const failingExecutor = {
      runPoll: vi.fn().mockRejectedValue(new Error('retry me')),
    } as unknown as TriggerExecutorService;
    registry = makeRegistry();
    // promote=0, reclaim=0, drain=job
    redis.eval
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(JSON.stringify({ ...baseJob, attempt: 1 }))
      .mockResolvedValue(null);

    const service = new DlqProcessorService(
      redis as unknown as import('ioredis').Redis,
      failingExecutor,
      registry,
    );

    await service.processDlq();

    // Must be scheduled into delayed sorted set, NOT pushed to ready queue
    expect(redis.zadd).toHaveBeenCalledWith(
      'dlq:triggers:delayed',
      expect.any(Number),
      expect.stringContaining('"attempt":2'),
    );
    expect(redis.lpush).not.toHaveBeenCalledWith(
      'dlq:triggers',
      expect.any(String),
    );
  });

  it('should move to failed list after MAX_ATTEMPTS exhausted', async () => {
    redis = makeRedis();
    const failingExecutor = {
      runPoll: vi.fn().mockRejectedValue(new Error('permanent fail')),
    } as unknown as TriggerExecutorService;
    registry = makeRegistry();
    // attempt: 3 means next attempt (4) hits the `nextAttempt > MAX_ATTEMPTS` limit (MAX_ATTEMPTS=3)
    // promote=0, reclaim=0, drain=job
    redis.eval
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(JSON.stringify({ ...baseJob, attempt: 3 }))
      .mockResolvedValue(null);

    const service = new DlqProcessorService(
      redis as unknown as import('ioredis').Redis,
      failingExecutor,
      registry,
    );

    await service.processDlq();

    expect(redis.lpush).toHaveBeenCalledWith(
      'dlq:triggers:failed',
      expect.stringContaining('exhaustedAt'),
    );
  });

  it('should promote delayed jobs that are due back into the ready queue', async () => {
    redis = makeRedis();
    executor = makeExecutor();
    registry = makeRegistry();
    const dueJob = JSON.stringify({
      ...baseJob,
      nextAttemptAt: Date.now() - 1,
    });
    // promote=1, reclaim=0, drain=job
    redis.eval
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(dueJob)
      .mockResolvedValue(null);

    const service = new DlqProcessorService(
      redis as unknown as import('ioredis').Redis,
      executor,
      registry,
    );

    await service.processDlq();

    // Lua eval should have been called with both DLQ keys (delayed + ready)
    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining('ZRANGEBYSCORE'),
      2, // numkeys
      'dlq:triggers:delayed',
      'dlq:triggers',
      expect.any(String), // now score
      expect.any(String), // batch size
    );

    // JS pipeline.lpush must NOT be called — Lua owns the LPUSH
    expect(redis._pipeline.lpush).not.toHaveBeenCalledWith(
      'dlq:triggers',
      expect.anything(),
    );
  });
});
