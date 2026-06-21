import { Module } from '@nestjs/common';
import { DatabaseModule } from '@soopa/database';
import { StorageResolverModule } from '@soopa/pipeline';
import { TraceController } from './trace.controller.js';
import { ConnectionExplorerController } from './connection-explorer.controller.js';

import { DrizzleTraceRepositoryAdapter } from './adapters/outbound/drizzle-trace.adapter.js';
import { DrizzleExplorerRepositoryAdapter } from './adapters/outbound/drizzle-explorer.adapter.js';
import { PipelineTraceStorageResolverAdapter } from './adapters/outbound/pipeline-trace-storage-resolver.adapter.js';

import { ListTracesUseCase } from './core/use-cases/trace/list-traces.use-case.js';
import { GetTraceUseCase } from './core/use-cases/trace/get-trace.use-case.js';

import { ListConnectionDataUseCase } from './core/use-cases/explorer/list-connection-data.use-case.js';
import { GetConnectionTraceUseCase } from './core/use-cases/explorer/get-connection-trace.use-case.js';
import { ListTraceRoutesUseCase } from './core/use-cases/explorer/list-trace-routes.use-case.js';
import { ListObjectsUseCase } from './core/use-cases/explorer/list-objects.use-case.js';

import { ListNormalizedTypesUseCase } from './core/use-cases/explorer/list-normalized-types.use-case.js';

@Module({
  imports: [DatabaseModule, StorageResolverModule],
  controllers: [TraceController, ConnectionExplorerController],
  providers: [
    // Adapters
    {
      provide: 'TRACE_REPOSITORY_PORT',
      useClass: DrizzleTraceRepositoryAdapter,
    },
    {
      provide: 'EXPLORER_REPOSITORY_PORT',
      useClass: DrizzleExplorerRepositoryAdapter,
    },
    {
      provide: 'TRACE_STORAGE_RESOLVER_PORT',
      useClass: PipelineTraceStorageResolverAdapter,
    },

    // Trace Use Cases
    ListTracesUseCase,
    GetTraceUseCase,

    // Explorer Use Cases
    ListConnectionDataUseCase,
    GetConnectionTraceUseCase,
    ListTraceRoutesUseCase,
    ListObjectsUseCase,
    ListNormalizedTypesUseCase,
  ],
})
export class TraceModule {}
