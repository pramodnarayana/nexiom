/* eslint-disable @typescript-eslint/unbound-method */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DlqProcessorService } from './dlq-processor.service';
import { TriggerStrategy } from '@nexiom/connections';
import type { TriggerExecutorService } from './trigger-executor.service';
import type { PieceRegistryService } from './piece-registry.service';

function makeRedis() {
  return {
    rpop: vi.fn(),
    lpush: vi.fn().mockResolvedValue(1),
  };
}

function makeExecutor() {
  return {
    runPoll: vi.fn().mockResolvedValue(undefined),
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
    redis.rpop.mockResolvedValue(null);

    const service = new DlqProcessorService(
      redis as unknown as import('ioredis').Redis,
      executor,
      registry,
    );

    const p = service.processDlq();
    await vi.runAllTimersAsync();
    await p;

    expect(executor.runPoll).not.toHaveBeenCalled();
  });

  it('should retry a valid job via executor.runPoll', async () => {
    redis = makeRedis();
    executor = makeExecutor();
    registry = makeRegistry();
    redis.rpop
      .mockResolvedValueOnce(JSON.stringify(baseJob))
      .mockResolvedValue(null);

    const service = new DlqProcessorService(
      redis as unknown as import('ioredis').Redis,
      executor,
      registry,
    );

    const p = service.processDlq();
    await vi.runAllTimersAsync();
    await p;

    expect(executor.runPoll).toHaveBeenCalledOnce();
  });

  it('should discard unparseable jobs', async () => {
    redis = makeRedis();
    executor = makeExecutor();
    registry = makeRegistry();
    redis.rpop
      .mockResolvedValueOnce('not-valid-json{{{')
      .mockResolvedValue(null);

    const service = new DlqProcessorService(
      redis as unknown as import('ioredis').Redis,
      executor,
      registry,
    );

    const p = service.processDlq();
    await vi.runAllTimersAsync();
    await p;

    expect(executor.runPoll).not.toHaveBeenCalled();
  });

  it('should discard job if trigger is not found in registry', async () => {
    redis = makeRedis();
    executor = makeExecutor();
    registry = makeRegistry(false);
    redis.rpop
      .mockResolvedValueOnce(JSON.stringify(baseJob))
      .mockResolvedValue(null);

    const service = new DlqProcessorService(
      redis as unknown as import('ioredis').Redis,
      executor,
      registry,
    );

    const p = service.processDlq();
    await vi.runAllTimersAsync();
    await p;

    expect(executor.runPoll).not.toHaveBeenCalled();
  });

  it('should re-queue job on failure if attempts remain', async () => {
    redis = makeRedis();
    const failingExecutor = {
      runPoll: vi.fn().mockRejectedValue(new Error('retry me')),
    } as unknown as TriggerExecutorService;
    registry = makeRegistry();
    redis.rpop
      .mockResolvedValueOnce(JSON.stringify({ ...baseJob, attempt: 1 }))
      .mockResolvedValue(null);

    const service = new DlqProcessorService(
      redis as unknown as import('ioredis').Redis,
      failingExecutor,
      registry,
    );

    const p = service.processDlq();
    await vi.runAllTimersAsync();
    await p;

    expect(redis.lpush).toHaveBeenCalledWith(
      'dlq:triggers',
      expect.stringContaining('"attempt":2'),
    );
  });

  it('should move to failed list after MAX_ATTEMPTS exhausted', async () => {
    redis = makeRedis();
    const failingExecutor = {
      runPoll: vi.fn().mockRejectedValue(new Error('permanent fail')),
    } as unknown as TriggerExecutorService;
    registry = makeRegistry();
    // attempt: 2 means next attempt (3) hits the limit
    redis.rpop
      .mockResolvedValueOnce(JSON.stringify({ ...baseJob, attempt: 2 }))
      .mockResolvedValue(null);

    const service = new DlqProcessorService(
      redis as unknown as import('ioredis').Redis,
      failingExecutor,
      registry,
    );

    const p = service.processDlq();
    await vi.runAllTimersAsync();
    await p;

    expect(redis.lpush).toHaveBeenCalledWith(
      'dlq:triggers:failed',
      expect.stringContaining('exhaustedAt'),
    );
  });
});
