/* eslint-disable @typescript-eslint/unbound-method */
import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { RedisBackedTriggerStore } from './redis-trigger-store.js';
import type { Redis } from 'ioredis';

function makeMockRedis() {
  return {
    hget: vi.fn(),
    hset: vi.fn(),
    hdel: vi.fn(),
  } as unknown as Redis;
}

describe('RedisBackedTriggerStore', () => {
  let redis: ReturnType<typeof makeMockRedis>;
  let store: RedisBackedTriggerStore;

  beforeEach(() => {
    redis = makeMockRedis();
    store = new RedisBackedTriggerStore(
      redis,
      'ws_test',
      'salesforce',
      'Account',
      'new_record',
    );
  });

  it('get() returns null when key does not exist', async () => {
    (redis.hget as Mock).mockResolvedValue(null);
    const result = await store.get('last_cursor');
    expect(result).toBeNull();
  });

  it('get() parses JSON values', async () => {
    (redis.hget as Mock).mockResolvedValue(
      JSON.stringify({ ts: '2024-01-01' }),
    );
    const result = await store.get<{ ts: string }>('last_cursor');
    expect(result).toEqual({ ts: '2024-01-01' });
  });

  it('get() returns raw string if not valid JSON', async () => {
    (redis.hget as Mock).mockResolvedValue('not-json');
    const result = await store.get<string>('key');
    expect(result).toBe('not-json');
  });

  it('put() serialises value to JSON and calls hset', async () => {
    (redis.hset as Mock).mockResolvedValue(1);
    await store.put('last_cursor', { ts: '2024-01-01' });
    expect(redis.hset).toHaveBeenCalledWith(
      'cursor:ws_test:salesforce:Account:new_record',
      'last_cursor',
      JSON.stringify({ ts: '2024-01-01' }),
    );
  });

  it('delete() calls hdel with the correct key', async () => {
    (redis.hdel as Mock).mockResolvedValue(1);
    await store.delete('last_cursor');
    expect(redis.hdel).toHaveBeenCalledWith(
      'cursor:ws_test:salesforce:Account:new_record',
      'last_cursor',
    );
  });

  it('uses "_" as object-type segment when objectType is undefined', async () => {
    // Instantiate with objectType=undefined to exercise the fallback branch.
    const noObjectStore = new RedisBackedTriggerStore(
      redis,
      'ws_test',
      'salesforce',
      undefined,
      'new_record',
    );
    (redis.hset as Mock).mockResolvedValue(1);
    await noObjectStore.put('last_cursor', 'ts');
    expect(redis.hset).toHaveBeenCalledWith(
      'cursor:ws_test:salesforce:_:new_record', // '_' fallback for missing objectType
      'last_cursor',
      JSON.stringify('ts'),
    );
  });
});
