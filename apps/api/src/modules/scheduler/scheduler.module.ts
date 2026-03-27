import { Module, type Type } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import {
  CursorManagerService,
  PiecesModule,
  PieceRegistryService,
} from '@nexiom/engine';
import { TokenManagerService } from '@nexiom/connectors';
import { REDIS_CLIENT } from '@nexiom/cache';
import { DATABASE_CONNECTION } from '@nexiom/database';
import { DbModule } from '../../db/db.module.js';
import { ConnectionsModule } from '../connections/connections.module.js';
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

// Evaluated once at module load time — env vars are set before app bootstrap.
const WINDMILL_ENABLED = process.env['WINDMILL_ENABLED'] === 'true';

// CursorResetController injects REDIS_CLIENT; only register it when Redis is
// expected to be present (i.e. WINDMILL_ENABLED=true).

const schedulerControllers: Type<any>[] = WINDMILL_ENABLED
  ? [SchedulerController, CursorResetController]
  : [SchedulerController];

@Module({
  imports: [DbModule, ConnectionsModule, PiecesModule],
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
      // Only instantiate the full PollSyncRunner (with its Redis + token deps)
      // when Windmill is enabled.  In local dev (WINDMILL_ENABLED=false) the
      // stub is returned so a missing Redis or credential provider does not
      // crash the process on startup.
      //
      // Heavy dependencies (Redis, DB, TokenManager, etc.) are resolved lazily
      // via ModuleRef so NestJS does not eagerly instantiate them when
      // WINDMILL_ENABLED=false — prevents startup failures in environments where
      // those providers are absent.
      provide: SyncRunner,
      inject: [ConfigService, ModuleRef],
      useFactory: (config: ConfigService, moduleRef: ModuleRef): SyncRunner => {
        if (config.get<string>('WINDMILL_ENABLED') === 'true') {
          return new PollSyncRunner(
            moduleRef.get(DATABASE_CONNECTION, { strict: false }),
            moduleRef.get(REDIS_CLIENT, { strict: false }),
            config,
            moduleRef.get(TokenManagerService, { strict: false }),
            moduleRef.get(PieceRegistryService, { strict: false }),
            moduleRef.get(CursorManagerService, { strict: false }),
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
