import { Module } from '@nestjs/common';
import { AuthModule } from '@soopa/auth';
import { DbModule } from '../../db/db.module.js';
import { StorageResolverModule } from '@soopa/engine';
import { ObservabilityModule } from '../observability/observability.module.js';
import { ExceptionService } from './exception.service.js';
import { ExceptionController } from './exception.controller.js';

@Module({
  imports: [DbModule, AuthModule, StorageResolverModule, ObservabilityModule],
  controllers: [ExceptionController],
  providers: [ExceptionService],
  exports: [ExceptionService],
})
export class ExceptionsModule {}
