import { Module } from '@nestjs/common';
import { DbModule } from '../../db/db.module.js';
import { REDIS_CLIENT } from '@soopa/cache';
import type { Redis } from '@soopa/cache';
import { PieceRegistryService } from '@soopa/piece-registry';
import { TriggerExecutorService } from './trigger-executor.service.js';
import { PollerService } from './poller.service.js';
import { DlqProcessorService } from './dlq-processor.service.js';
import { DATABASE_CONNECTION } from '@soopa/database';
import type { DrizzleDb } from '@soopa/database';
import { DB_MANAGER } from '@soopa/dbmanager';
import type { DatabaseManager } from '@soopa/dbmanager';
import { StorageResolverModule, StorageResolverService } from '@soopa/engine';

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
      provide: TriggerExecutorService,
      useFactory: (
        db: DrizzleDb,
        redis: Redis,
        dbManager: DatabaseManager,
        storageResolver: StorageResolverService,
      ) => new TriggerExecutorService(db, redis, dbManager, storageResolver),
      inject: [
        DATABASE_CONNECTION,
        REDIS_CLIENT,
        DB_MANAGER,
        StorageResolverService,
      ],
    },
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
        redis: Redis,
        executor: TriggerExecutorService,
        registry: PieceRegistryService,
      ) => new DlqProcessorService(redis, executor, registry),
      inject: [REDIS_CLIENT, TriggerExecutorService, PieceRegistryService],
    },
  ],
  exports: [TriggerExecutorService],
})
export class TriggerModule {}
