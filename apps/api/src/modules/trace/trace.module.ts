import { Module } from '@nestjs/common';
import { AuthModule } from '@soopa/auth';
import { DatabaseModule } from '@soopa/database';
import { StorageResolverModule } from '@soopa/pipeline';
import { ObservabilityModule } from '../observability/observability.module.js';
import { TraceService } from './trace.service.js';
import { TraceController } from './trace.controller.js';
import { DataExplorerService } from './data-explorer.service.js';
import { ConnectionExplorerController } from './connection-explorer.controller.js';

@Module({
  imports: [
    DatabaseModule,
    AuthModule,
    StorageResolverModule,
    ObservabilityModule,
  ],
  controllers: [TraceController, ConnectionExplorerController],
  providers: [TraceService, DataExplorerService],
  exports: [TraceService],
})
export class TraceModule {}
