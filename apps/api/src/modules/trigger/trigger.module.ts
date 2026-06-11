import { Module } from '@nestjs/common';
import { DbModule } from '../../db/db.module.js';
import { REDIS_CLIENT } from '@soopa/cache';
import type { Redis } from '@soopa/cache';

import { PieceRegistryService } from '@soopa/piece-registry';
import { TriggerExecutorService } from './trigger-executor.service.js';
import { PollerService } from './poller.service.js';
import { DlqProcessorService } from './dlq-processor.service.js';
import { TriggerPayloadTransformer } from './trigger-payload-transformer.js';
import { TriggerRetryPolicyService } from './trigger-retry-policy.service.js';
import { DATABASE_CONNECTION } from '@soopa/database';
import type { DrizzleDb } from '@soopa/database';
import { StorageResolverModule } from '@soopa/pipeline';
import { IDistributedLockService } from './interfaces/distributed-lock.interface.js';
import { ITriggerDlqService } from './interfaces/trigger-dlq.interface.js';
import { RedisDistributedLockService } from './infrastructure/redis-distributed-lock.service.js';
import { RedisTriggerDlqService } from './infrastructure/redis-trigger-dlq.service.js';

/**
 * Wires all trigger-related services.
 *
 * Redis is provided globally by CacheModule (imported in AppModule).
 * ScheduleModule is registered globally in AppModule via ScheduleModule.forRoot().
 */
@Module({
  imports: [DbModule, StorageResolverModule],
  providers: [
    {
      provide: IDistributedLockService,
      useClass: RedisDistributedLockService,
    },
    {
      provide: ITriggerDlqService,
      useClass: RedisTriggerDlqService,
    },
    {
      provide: 'KEY_VALUE_STORE',
      useFactory: (redis: Redis) => redis,
      inject: [REDIS_CLIENT],
    },
    TriggerPayloadTransformer,
    TriggerRetryPolicyService,
    TriggerExecutorService,
    {
      provide: PollerService,
      useFactory: (
        db: DrizzleDb,
        executor: TriggerExecutorService,
        registry: PieceRegistryService,
      ) => new PollerService(db, executor, registry),
      inject: [
        DATABASE_CONNECTION,
        TriggerExecutorService,
        PieceRegistryService,
      ],
    },
    {
      provide: DlqProcessorService,
      useFactory: (
        dlqService: ITriggerDlqService,
        executor: TriggerExecutorService,
        registry: PieceRegistryService,
      ) => new DlqProcessorService(dlqService, executor, registry),
      inject: [
        ITriggerDlqService,
        TriggerExecutorService,
        PieceRegistryService,
      ],
    },
  ],
  exports: [TriggerExecutorService],
})
export class TriggerModule {}
