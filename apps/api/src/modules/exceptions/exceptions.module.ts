import { Module } from '@nestjs/common';
import { AuthModule } from '@nexiom/auth';
import { DbModule } from '../../db/db.module.js';
import { StorageResolverModule } from '@nexiom/engine';
import { ExceptionService } from './exception.service.js';
import { ExceptionController } from './exception.controller.js';

@Module({
  imports: [DbModule, AuthModule, StorageResolverModule],
  controllers: [ExceptionController],
  providers: [ExceptionService],
  exports: [ExceptionService],
})
export class ExceptionsModule {}
