import { Module } from '@nestjs/common';
import { AuthModule } from '@soopa/auth';
import { DatabaseModule } from '@soopa/database';
import { StorageResolverModule } from '@soopa/pipeline';
import { ObservabilityModule } from '../observability/observability.module.js';
import { ExceptionService } from './exception.service.js';
import { IDeliveryQueueDispatcher } from './interfaces/delivery-queue-dispatcher.interface.js';
import { SoopaDeliveryQueueDispatcherService } from './infrastructure/soopa-delivery-queue-dispatcher.service.js';
import { ExceptionController } from './exception.controller.js';

@Module({
  imports: [
    DatabaseModule,
    AuthModule,
    StorageResolverModule,
    ObservabilityModule,
  ],
  controllers: [ExceptionController],
  providers: [
    ExceptionService,
    {
      provide: IDeliveryQueueDispatcher,
      useClass: SoopaDeliveryQueueDispatcherService,
    },
  ],
  exports: [ExceptionService],
})
export class ExceptionsModule {}
