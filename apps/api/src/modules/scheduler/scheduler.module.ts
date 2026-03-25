import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CursorManagerService } from '@nexiom/engine';
import { TokenManagerService } from '@nexiom/connectors';
import { REDIS_CLIENT, type Redis } from '@nexiom/cache';
import { DATABASE_CONNECTION, type DrizzleDb } from '@nexiom/database';
import { DbModule } from '../../db/db.module.js';
import { ConnectionsModule } from '../connections/connections.module.js';
import { PiecesModule } from '../pieces/pieces.module.js';
import { PieceRegistryService } from '../trigger/piece-registry.service.js';
import { WindmillClient } from './windmill.client.js';
import { HttpWindmillClient } from './http-windmill.client.js';
import { StubWindmillClient } from './stub-windmill.client.js';
import { SyncRunner } from './sync-runner.js';
import { PollSyncRunner } from './poll-sync-runner.js';
import { StubSyncRunner } from './stub-sync-runner.js';
import { SchedulerService } from './scheduler.service.js';
import { SchedulerController } from './scheduler.controller.js';
import { CursorResetController } from './cursor-reset.controller.js';
import { InternalSchedulerGuard } from './internal-scheduler.guard.js';
import { OutboxWorkerService } from './outbox-worker.service.js';

@Module({
  imports: [DbModule, ConnectionsModule, PiecesModule],
  controllers: [SchedulerController, CursorResetController],
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
      // Only instantiate the full PollSyncRunner (with its Redis + token deps)
      // when Windmill is enabled.  In local dev (WINDMILL_ENABLED=false) the
      // stub is returned so a missing Redis or credential provider does not
      // crash the process on startup.
      provide: SyncRunner,
      inject: [
        ConfigService,
        DATABASE_CONNECTION,
        REDIS_CLIENT,
        TokenManagerService,
        PieceRegistryService,
        CursorManagerService,
      ],
      useFactory: (
        config: ConfigService,
        db: DrizzleDb,
        redis: Redis,
        tokenManager: TokenManagerService,
        pieceRegistry: PieceRegistryService,
        cursorManager: CursorManagerService,
      ): SyncRunner => {
        if (config.get<string>('WINDMILL_ENABLED') === 'true') {
          return new PollSyncRunner(
            db,
            redis,
            config,
            tokenManager,
            pieceRegistry,
            cursorManager,
          );
        }
        return new StubSyncRunner();
      },
    },
    SchedulerService,
    InternalSchedulerGuard,
    OutboxWorkerService,
  ],
  exports: [SchedulerService],
})
export class SchedulerModule {}
