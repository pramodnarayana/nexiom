export interface IDistributedLock {
    acquire(key: string, value: string, ttlMs: number): Promise<boolean>;
    release(key: string, value: string): Promise<void>;
}
