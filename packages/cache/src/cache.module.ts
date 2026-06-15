import { Global, Module, Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import { RedisPubSubService } from './redis-pub-sub.service.js';
import { REDIS_CLIENT, KEY_VALUE_STORE, PUB_SUB_CLIENT } from './constants.js';

export type { Redis };

/**
 * Internal token used to hold the lifecycle-managed wrapper.
 * Not exported — consumers always inject REDIS_CLIENT for the raw Redis instance.
 */
const REDIS_LIFECYCLE = 'REDIS_LIFECYCLE';

/**
 * Registers itself with Nest's DI so onModuleDestroy is called on shutdown,
 * then calls client.quit() to close TCP sockets gracefully.
 */
@Injectable()
class RedisLifecycleService implements OnModuleDestroy {
    constructor(private readonly client: Redis) { }

    async onModuleDestroy(): Promise<void> {
        try {
            await this.client.quit();
        } catch {
            // quit() may fail if connection already dropped; force-disconnect.
            this.client.disconnect();
        }
    }
}

/**
 * @Global module — import once in AppModule; all other modules receive the
 * REDIS_CLIENT token automatically without importing CacheModule themselves.
 *
 * Key namespacing convention:
 *   rl:{url}                                               — rate limiter
 *   token:{connectionId}                                   — OAuth token cache
 *   cursor:{workspaceId}:{appName}:{objectType}:{name}     — polling cursors
 *   lock:poll:{workspaceId}:{triggerName}                  — distributed locks
 *   dlq:triggers                                           — DLQ ready queue
 *   dlq:triggers:processing                                — in-flight jobs
 *   dlq:triggers:delayed                                   — deferred retries
 *   dlq:triggers:failed                                    — exhausted jobs
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
        {
            provide: KEY_VALUE_STORE,
            useExisting: REDIS_CLIENT,
        },
        {
            provide: PUB_SUB_CLIENT,
            useClass: RedisPubSubService,
        },
        {
            // Lifecycle service — injected only so Nest calls onModuleDestroy.
            provide: REDIS_LIFECYCLE,
            inject: [REDIS_CLIENT],
            useFactory: (client: Redis) => new RedisLifecycleService(client),
        },
    ],
    exports: [REDIS_CLIENT, KEY_VALUE_STORE, PUB_SUB_CLIENT],
})
export class CacheModule { }
