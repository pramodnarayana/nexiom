import { Module } from '@nestjs/common';
import { AuthModule } from '@nexiom/auth';
import { DbModule } from '../../db/db.module.js';
import { StorageResolverModule } from '@nexiom/engine';
import { ObservabilityModule } from '../observability/observability.module.js';
import { TraceService } from './trace.service.js';
import { TraceController } from './trace.controller.js';
import { DataExplorerService } from './data-explorer.service.js';
import { DataExplorerController } from './data-explorer.controller.js';

@Module({
  imports: [DbModule, AuthModule, StorageResolverModule, ObservabilityModule],
  controllers: [TraceController, DataExplorerController],
  providers: [TraceService, DataExplorerService],
  exports: [TraceService],
})
export class TraceModule {}
