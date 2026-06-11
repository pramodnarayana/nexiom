import { Module, type Type } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CursorManagerService,
  StorageResolverModule,
  StorageResolverService,
} from '@soopa/pipeline';
import { PiecesModule, PieceRegistryService } from '@soopa/piece-registry';
import { TokenManagerService } from '@soopa/credentials';
import { REDIS_CLIENT } from '@soopa/cache';
import { DATABASE_CONNECTION, type DrizzleDb } from '@soopa/database';
import { DB_MANAGER, type DatabaseManager } from '@soopa/dbmanager';
import type { Redis } from 'ioredis';
import { DatabaseModule } from '@soopa/database';
import { ConnectionsModule } from '../connections/connections.module.js';
import { ISchedulerClient } from './interfaces/scheduler-client.interface.js';
import { IHttpClient } from './interfaces/http-client.interface.js';
import { FetchHttpClient } from './infrastructure/fetch-http.client.js';
import { WindmillSchedulerClient } from './infrastructure/windmill-scheduler.client.js';
import { StubSchedulerClient } from './infrastructure/stub-scheduler.client.js';
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
  imports: [
    DatabaseModule,
    ConnectionsModule,
    PiecesModule,
    StorageResolverModule,
  ],
  controllers: schedulerControllers,
  providers: [
    {
      provide: IHttpClient,
      useClass: FetchHttpClient,
    },
    {
      provide: ISchedulerClient,
      inject: [ConfigService, IHttpClient],
      useFactory: (
        config: ConfigService,
        httpClient: IHttpClient,
      ): ISchedulerClient => {
        const enabled = config.get<string>('WINDMILL_ENABLED') === 'true';
        return enabled
          ? new WindmillSchedulerClient(config, httpClient)
          : new StubSchedulerClient();
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
