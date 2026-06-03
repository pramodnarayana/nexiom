import type { TriggerStore } from '@soopa/piece-framework';
import type { Redis } from 'ioredis';

/**
 * Redis-backed TriggerStore.
 *
 * All cursor state is stored as a Redis Hash under a fully-qualified key:
 *   cursor:{workspaceId}:{appName}:{objectType}:{triggerName}
 *
 * Using all four dimensions prevents cross-object collisions when the same
 * trigger runs for different object types (e.g., Account vs Contact) within
 * the same workspace.
 *
 * Key namespace separation:
 *   - Cursor keys:        cursor:...
 *   - Rate-limiter keys:  rl:...
 *   - Token cache keys:   token:...
 *   - DLQ list:           dlq:triggers
 *   - Poll locks:         lock:poll:...
 */
export class RedisBackedTriggerStore implements TriggerStore {
  private readonly hashKey: string;

  constructor(
    private readonly redis: Redis,
    workspaceId: string,
    appName: string,
    objectType: string | undefined,
    triggerName: string,
  ) {
    const objSegment = objectType ?? '_';
    this.hashKey = `cursor:${workspaceId}:${appName}:${objSegment}:${triggerName}`;
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
