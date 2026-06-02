import { Module, type Type } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CursorManagerService,
  StorageResolverModule,
  StorageResolverService,
} from '@nexiom/engine';
import { PiecesModule, PieceRegistryService } from '@nexiom/piece-registry';
import { TokenManagerService } from '@nexiom/credentials';
import { REDIS_CLIENT } from '@nexiom/cache';
import { DATABASE_CONNECTION, type DrizzleDb } from '@nexiom/database';
import { DB_MANAGER, type DatabaseManager } from '@nexiom/dbmanager';
import type { Redis } from 'ioredis';
import { DbModule } from '../../db/db.module.js';
import { ConnectionsModule } from '../connections/connections.module.js';
import { WindmillClient } from './windmill.client.js';
import { HttpWindmillClient } from './http-windmill.client.js';
import { StubWindmillClient } from './stub-windmill.client.js';
import { SyncRunner } from './sync-runner.js';
import { ConnectionSyncRunner } from './connection-sync-runner.js';
import { SchedulerService } from './scheduler.service.js';
import { SchedulerController } from './scheduler.controller.js';
import { CursorResetController } from './cursor-reset.controller.js';
import { InternalSchedulerGuard } from './internal-scheduler.guard.js';
import { SchedulerOutboxPoller } from './scheduler-outbox.poller.js';

// Evaluated once at module load time — env vars are set before app bootstrap.
const WINDMILL_ENABLED = process.env['WINDMILL_ENABLED'] === 'true';

// CursorResetController injects REDIS_CLIENT; only register it when Redis is
// expected to be present (i.e. WINDMILL_ENABLED=true).

const schedulerControllers: Type<any>[] = WINDMILL_ENABLED
  ? [SchedulerController, CursorResetController]
  : [SchedulerController];

@Module({
  imports: [DbModule, ConnectionsModule, PiecesModule, StorageResolverModule],
  controllers: schedulerControllers,
  providers: [
    {
      provide: WindmillClient,
      inject: [ConfigService],
      useFactory: (config: ConfigService): WindmillClient => {
        const enabled = config.get<string>('WINDMILL_ENABLED') === 'true';
        return enabled
          ? new HttpWindmillClient(config)
          : new StubWindmillClient();
      },
    },
    CursorManagerService,
    {
      provide: SyncRunner,
      inject: [
        ConfigService,
        DATABASE_CONNECTION,
        DB_MANAGER,
        REDIS_CLIENT,
        TokenManagerService,
        PieceRegistryService,
        CursorManagerService,
        StorageResolverService,
      ],
      useFactory: (
        _config: ConfigService,
        db: DrizzleDb,
        dbManager: DatabaseManager,
        redis: Redis,
        tokenManager: TokenManagerService,
        pieceRegistry: PieceRegistryService,
        cursorManager: CursorManagerService,
        storageResolver: StorageResolverService,
      ): SyncRunner => {
        return new ConnectionSyncRunner(
          db,
          dbManager,
          redis,
          _config,
          tokenManager,
          pieceRegistry,
          cursorManager,
          storageResolver,
        );
      },
    },
    SchedulerService,
    InternalSchedulerGuard,
    SchedulerOutboxPoller,
  ],
  exports: [SchedulerService, SchedulerOutboxPoller, SyncRunner],
})
export class SchedulerModule {}
