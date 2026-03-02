import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

/** Injection token for the single shared Redis client across the entire application. */
export const REDIS_CLIENT = 'REDIS_CLIENT';

export type { Redis };

/**
 * @Global module — import once in AppModule; all other modules receive the
 * REDIS_CLIENT token automatically without importing CacheModule themselves.
 *
 * Key namespacing convention:
 *   rl:{url}                              — rate limiter (HostHttpClient)
 *   token:{connectionId}                  — OAuth token cache (TokenManagerService)
 *   cursor:{workspaceId}:{triggerName}    — polling cursors (TriggerStore)
 *   lock:poll:{workspaceId}:{triggerName} — distributed poll locks
 *   dlq:triggers                          — dead-letter queue for failed trigger runs
 *   dlq:triggers:failed                   — exhausted DLQ jobs for human inspection
 */
@Global()
@Module({
    providers: [
        {
            provide: REDIS_CLIENT,
            inject: [ConfigService],
            useFactory: async (config: ConfigService): Promise<Redis> => {
                const redisUrl = config.get<string>('REDIS_URL');
                if (!redisUrl && config.get<string>('NODE_ENV') !== 'development') {
                    throw new Error('REDIS_URL environment variable is missing');
                }
                const client = new Redis(redisUrl || 'redis://localhost:6379', {
                    connectTimeout: 10_000,
                    maxRetriesPerRequest: 3,
                    enableReadyCheck: true,
                    lazyConnect: true,
                });
                await client.connect();
                return client;
            },
        },
    ],
    exports: [REDIS_CLIENT],
})
export class CacheModule { }
