import { Module } from '@nestjs/common';
import { DbModule } from '../../db/db.module.js';
import { REDIS_CLIENT } from '@nexiom/cache';
import type { Redis } from '@nexiom/cache';
import { PieceRegistryService } from '@nexiom/engine';
import { TriggerExecutorService } from './trigger-executor.service.js';
import { PollerService } from './poller.service.js';
import { DlqProcessorService } from './dlq-processor.service.js';
import { WebhooksController } from './webhooks.controller.js';
import { DATABASE_CONNECTION } from '@nexiom/database';
import type { DrizzleDb } from '@nexiom/database';
import { DB_MANAGER } from '../dbmanager/dbmanager.module.js';
import type { DatabaseManager } from '@nexiom/dbmanager';

/**
 * Wires all trigger-related services.
 *
 * Redis is provided globally by CacheModule (imported in AppModule).
 * ScheduleModule is registered globally in AppModule via ScheduleModule.forRoot().
 */
@Module({
  imports: [DbModule],
  controllers: [WebhooksController],
  providers: [
    {
      provide: TriggerExecutorService,
      useFactory: (db: DrizzleDb, redis: Redis, dbManager: DatabaseManager) =>
        new TriggerExecutorService(db, redis, dbManager),
      inject: [DATABASE_CONNECTION, REDIS_CLIENT, DB_MANAGER],
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
