import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DbModule } from '../../db/db.module.js';
import { WindmillClient } from './windmill.client.js';
import { HttpWindmillClient } from './http-windmill.client.js';
import { StubWindmillClient } from './stub-windmill.client.js';
import { SyncRunner } from './sync-runner.js';
import { StubSyncRunner } from './stub-sync-runner.js';
import { SchedulerService } from './scheduler.service.js';
import { SchedulerController } from './scheduler.controller.js';
import { InternalSchedulerGuard } from './internal-scheduler.guard.js';
import { OutboxWorkerService } from './outbox-worker.service.js';

@Module({
  imports: [DbModule],
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
    { provide: SyncRunner, useClass: StubSyncRunner },
    StubSyncRunner,
    SchedulerService,
    InternalSchedulerGuard,
    OutboxWorkerService,
  ],
  exports: [SchedulerService],
})
export class SchedulerModule {}
