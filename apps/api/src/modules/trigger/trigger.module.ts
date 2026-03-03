import { Module } from '@nestjs/common';
import { DbModule } from '../../db/db.module';
import { REDIS_CLIENT } from '@nexiom/cache';
import type { Redis } from '@nexiom/cache';
import { PieceRegistryService } from './piece-registry.service';
import { TriggerExecutorService } from './trigger-executor.service';
import { PollerService } from './poller.service';
import { DlqProcessorService } from './dlq-processor.service';
import { WebhooksController } from './webhooks.controller';
import { DATABASE_CONNECTION } from '@nexiom/database';
import type { DrizzleDb } from '@nexiom/database';
import { DB_MANAGER } from '../dbmanager/dbmanager.module';
import { DatabaseManager } from '@nexiom/dbmanager';

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
    PieceRegistryService,
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
  exports: [PieceRegistryService, TriggerExecutorService],
})
export class TriggerModule {}
