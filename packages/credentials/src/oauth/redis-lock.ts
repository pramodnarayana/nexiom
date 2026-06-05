import type { Redis } from 'ioredis';
import { IDistributedLock } from './token-manager.service.js';

export class RedisDistributedLock implements IDistributedLock {
    constructor(private readonly redis: Redis) {}

    async acquire(key: string, value: string, ttlMs: number): Promise<boolean> {
        const result = await this.redis.set(key, value, 'PX', ttlMs, 'NX');
        return result !== null;
    }

    async release(key: string, value: string): Promise<void> {
        const luaScript = `
            if redis.call("get", KEYS[1]) == ARGV[1] then
                return redis.call("del", KEYS[1])
            else
                return 0
            end
        `;
        await this.redis.eval(luaScript, 1, key, value);
    }
}
