import type { IKeyValueStore } from '@soopa/cache';

export class FakeKeyValueStore implements IKeyValueStore {
  public store = new Map<string, string>();
  public callCount = { set: 0, get: 0, del: 0 };

  set(
    key: string,
    value: string | Buffer | number,
    _mode?: string,
    _duration?: number,
    _flag?: string,
  ): Promise<'OK' | null> {
    this.callCount.set++;
    this.store.set(key, value.toString());
    return Promise.resolve('OK');
  }

  get(key: string): Promise<string | null> {
    this.callCount.get++;
    const val = this.store.get(key);
    return Promise.resolve(val !== undefined ? val : null);
  }

  del(key: string): Promise<number> {
    this.callCount.del++;
    const existed = this.store.has(key);
    this.store.delete(key);
    return Promise.resolve(existed ? 1 : 0);
  }

  eval(
    _script: string,
    _numkeys: number,
    ..._args: (string | Buffer | number)[]
  ): Promise<unknown> {
    return Promise.reject(
      new Error('FakeKeyValueStore: eval not implemented in fake'),
    );
  }

  lpush(
    _key: string,
    ..._values: (string | Buffer | number)[]
  ): Promise<number> {
    return Promise.reject(
      new Error('FakeKeyValueStore: lpush not implemented in fake'),
    );
  }

  rpop(_key: string): Promise<string | null> {
    return Promise.reject(
      new Error('FakeKeyValueStore: rpop not implemented in fake'),
    );
  }

  hget(key: string, field: string): Promise<string | null> {
    this.callCount.get++;
    const hash = this.store.get(key);
    if (!hash) return Promise.resolve(null);
    try {
      const parsed = JSON.parse(hash) as Record<string, string>;
      const val = parsed[field];
      return Promise.resolve(val !== undefined ? String(val) : null);
    } catch {
      return Promise.resolve(null);
    }
  }

  hset(
    key: string,
    field: string,
    value: string | Buffer | number,
  ): Promise<number> {
    this.callCount.set++;
    const hashStr = this.store.get(key);
    let parsed: Record<string, string> = {};
    if (hashStr) {
      try {
        parsed = JSON.parse(hashStr) as Record<string, string>;
      } catch (_e) {
        // ignore
      }
    }
    const isNew = parsed[field] === undefined ? 1 : 0;
    parsed[field] = value.toString();
    this.store.set(key, JSON.stringify(parsed));
    return Promise.resolve(isNew);
  }

  hdel(_key: string, ..._fields: string[]): Promise<number> {
    return Promise.reject(
      new Error('FakeKeyValueStore: hdel not implemented in fake'),
    );
  }
}
