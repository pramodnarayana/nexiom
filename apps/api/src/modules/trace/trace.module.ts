import { Module } from '@nestjs/common';
import { AuthModule } from '@nexiom/auth';
import { DbModule } from '../../db/db.module.js';
import { StorageResolverModule } from '@nexiom/engine';
import { TraceService } from './trace.service.js';
import { TraceController } from './trace.controller.js';

@Module({
  imports: [DbModule, AuthModule, StorageResolverModule],
  controllers: [TraceController],
  providers: [TraceService],
  exports: [TraceService],
})
export class TraceModule {}
