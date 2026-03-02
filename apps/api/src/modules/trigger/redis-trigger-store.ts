import type { TriggerStore } from '@nexiom/connections';
import type { Redis } from 'ioredis';

/**
 * Redis-backed TriggerStore.
 *
 * All cursor state is stored as a Redis Hash under:
 *   cursor:{workspaceId}:{triggerName}
 *
 * This keeps it clearly separated from:
 *   - rate limiter keys  (rl:...)
 *   - token cache keys   (token:...)
 *   - DLQ list           (dlq:triggers)
 */
export class RedisBackedTriggerStore implements TriggerStore {
  private readonly hashKey: string;

  constructor(
    private readonly redis: Redis,
    workspaceId: string,
    triggerName: string,
  ) {
    this.hashKey = `cursor:${workspaceId}:${triggerName}`;
  }

  async get<T>(key: string): Promise<T | null> {
    const raw = await this.redis.hget(this.hashKey, key);
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return raw as unknown as T;
    }
  }

  async put<T>(key: string, value: T): Promise<void> {
    await this.redis.hset(this.hashKey, key, JSON.stringify(value));
  }

  async delete(key: string): Promise<void> {
    await this.redis.hdel(this.hashKey, key);
  }
}
