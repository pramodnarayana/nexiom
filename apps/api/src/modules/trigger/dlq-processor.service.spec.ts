/* eslint-disable @typescript-eslint/unbound-method */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DlqProcessorService } from './dlq-processor.service';
import { TriggerStrategy } from '@nexiom/connections';
import type { TriggerExecutorService } from './trigger-executor.service';
import type { PieceRegistryService } from './piece-registry.service';

/**
 * Minimal Redis mock that supports the DLQ surface:
 *   zpopmin, pipeline, rpoplpush, lrem, lpush, zadd
 */
function makeRedis() {
  const pipeline = {
    zadd: vi.fn().mockReturnThis(),
    lpush: vi.fn().mockReturnThis(),
    exec: vi.fn().mockResolvedValue([]),
  };

  return {
    // delayed-set promotion (atomic remove-and-return)
    zpopmin: vi.fn().mockResolvedValue([]), // returns [member, score, ...]
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
  failedAt: new Date().toISOString(),
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
    // zrangebyscore returns nothing, rpoplpush returns nothing
    redis.rpoplpush.mockResolvedValue(null);

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
    redis.rpoplpush
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

  it('should requeue job without incrementing attempt when lock is held (runPoll=false)', async () => {
    redis = makeRedis();
    executor = makeExecutor(false); // lock contention
    registry = makeRegistry();
    redis.rpoplpush
      .mockResolvedValueOnce(JSON.stringify(baseJob))
      .mockResolvedValue(null);

    const service = new DlqProcessorService(
      redis as unknown as import('ioredis').Redis,
      executor,
      registry,
    );

    await service.processDlq();

    // Job MUST be pushed back, not lost
    expect(redis.lpush).toHaveBeenCalledWith(
      'dlq:triggers',
      JSON.stringify(baseJob),
    );
    // Attempt must NOT have incremented
    const requeued = JSON.parse(
      (redis.lpush.mock.calls[0] as string[])[1],
    ) as typeof baseJob;
    expect(requeued.attempt).toBe(baseJob.attempt);
  });

  it('should discard unparseable jobs and log a fingerprint (not the raw payload)', async () => {
    redis = makeRedis();
    executor = makeExecutor();
    registry = makeRegistry();
    redis.rpoplpush
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
    redis.rpoplpush
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
    redis.rpoplpush
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
    // attempt: 2 means next attempt (3) hits the MAX_ATTEMPTS=3 limit
    redis.rpoplpush
      .mockResolvedValueOnce(JSON.stringify({ ...baseJob, attempt: 2 }))
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
    const score = String(Date.now() - 1);
    // zpopmin returns alternating [member, score] pairs
    redis.zpopmin.mockResolvedValue([dueJob, score]);
    // After promotion via pipeline.lpush, drain picks up the job
    redis.rpoplpush.mockResolvedValueOnce(dueJob).mockResolvedValue(null);

    const service = new DlqProcessorService(
      redis as unknown as import('ioredis').Redis,
      executor,
      registry,
    );

    await service.processDlq();

    // Due job promoted to ready queue via pipeline.lpush (no zrem needed — zpopmin already removed it)
    expect(redis._pipeline.lpush).toHaveBeenCalledWith('dlq:triggers', dueJob);
    expect(redis._pipeline.exec).toHaveBeenCalled();
  });
});
