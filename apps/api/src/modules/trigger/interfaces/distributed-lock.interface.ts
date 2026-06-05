export const IDistributedLockService = Symbol('IDistributedLockService');

export interface IDistributedLockService {
  acquireLock(key: string, ttlMs: number): Promise<string | null>;
  releaseLock(key: string, token: string): Promise<void>;
}
