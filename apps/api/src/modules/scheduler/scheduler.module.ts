import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WindmillClient } from './windmill.client.js';
import { HttpWindmillClient } from './http-windmill.client.js';
import { StubWindmillClient } from './stub-windmill.client.js';
import { SchedulerService } from './scheduler.service.js';
import { SchedulerController } from './scheduler.controller.js';
import { InternalSchedulerGuard } from './internal-scheduler.guard.js';

@Module({
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
    SchedulerService,
    InternalSchedulerGuard,
  ],
  exports: [SchedulerService],
})
export class SchedulerModule {}
