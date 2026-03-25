import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CursorManagerService } from '@nexiom/engine';
import { DbModule } from '../../db/db.module.js';
import { ConnectionsModule } from '../connections/connections.module.js';
import { PiecesModule } from '../pieces/pieces.module.js';
import { WindmillClient } from './windmill.client.js';
import { HttpWindmillClient } from './http-windmill.client.js';
import { StubWindmillClient } from './stub-windmill.client.js';
import { SyncRunner } from './sync-runner.js';
import { PollSyncRunner } from './poll-sync-runner.js';
import { SchedulerService } from './scheduler.service.js';
import { SchedulerController } from './scheduler.controller.js';
import { InternalSchedulerGuard } from './internal-scheduler.guard.js';
import { OutboxWorkerService } from './outbox-worker.service.js';

@Module({
  imports: [DbModule, ConnectionsModule, PiecesModule],
  controllers: [SchedulerController],
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
    { provide: SyncRunner, useClass: PollSyncRunner },
    SchedulerService,
    InternalSchedulerGuard,
    OutboxWorkerService,
  ],
  exports: [SchedulerService],
})
export class SchedulerModule {}
