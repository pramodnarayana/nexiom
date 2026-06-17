import type { IDistributedLockService } from '../../interfaces/distributed-lock.interface.js';

export class FakeDistributedLockService implements IDistributedLockService {
  public locks = new Map<string, string>(); // key -> token
  public callCount = { acquireLock: 0, releaseLock: 0 };

  acquireLock(key: string, _ttlMs: number): Promise<string | null> {
    this.callCount.acquireLock++;
    if (this.locks.has(key)) {
      return Promise.resolve(null);
    }
    const token = `fake-token-${Date.now()}`;
    this.locks.set(key, token);
    return Promise.resolve(token);
  }

  releaseLock(key: string, token: string): Promise<void> {
    this.callCount.releaseLock++;
    if (this.locks.get(key) === token) {
      this.locks.delete(key);
    }
    return Promise.resolve();
  }

  // Test helper to simulate an already-held lock
  holdLock(key: string) {
    this.locks.set(key, 'pre-held-token');
  }
}
