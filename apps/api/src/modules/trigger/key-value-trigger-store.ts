import type { TriggerStore } from '@soopa/piece-framework';
import type { IKeyValueStore } from '@soopa/cache';

/**
 * Generic key-value backed TriggerStore using IKeyValueStore.
 *
 * All cursor state is stored under a fully-qualified logical hash key:
 *   cursor:{workspaceId}:{appName}:{objectType}:{triggerName}
 *
 * Using all four dimensions prevents cross-object collisions when the same
 * trigger runs for different object types (e.g., Account vs Contact) within
 * the same workspace.
 *
 * Logical Key namespace separation:
 *   - Cursor keys:        cursor:...
 *   - Rate-limiter keys:  rl:...
 *   - Token cache keys:   token:...
 *   - DLQ list:           dlq:triggers
 *   - Poll locks:         lock:poll:...
 *
 * Note that the underlying storage is abstracted by IKeyValueStore.
 */
export class KeyValueTriggerStore implements TriggerStore {
  private readonly hashKey: string;

  constructor(
    private readonly store: IKeyValueStore,
    workspaceId: string,
    appName: string,
    objectType: string | undefined,
    triggerName: string,
  ) {
    const objSegment = objectType ?? '_';
    this.hashKey = `cursor:${workspaceId}:${appName}:${objSegment}:${triggerName}`;
  }

  async get<T>(key: string): Promise<T | null> {
    const raw = await this.store.hget(this.hashKey, key);
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return raw as unknown as T;
    }
  }

  async put<T>(key: string, value: T): Promise<void> {
    await this.store.hset(this.hashKey, key, JSON.stringify(value));
  }

  async delete(key: string): Promise<void> {
    await this.store.hdel(this.hashKey, key);
  }
}
