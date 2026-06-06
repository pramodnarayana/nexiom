import { Module } from '@nestjs/common';

import { CdcRelayController } from './cdc-relay.controller.js';
import { CdcRelayGuard } from './cdc-relay.guard.js';
import { QueueModule } from '@soopa/queue';
import { StorageResolverModule } from '@soopa/engine';
import { DbModule } from '../../db/db.module.js';
import { ObservabilityModule } from '../observability/observability.module.js';

import { PipelineCdcListener } from './pipeline-cdc.listener.js';
import { DbManagerModule } from '../dbmanager/dbmanager.module.js';

@Module({
  imports: [
    DbModule,
    StorageResolverModule,
    ObservabilityModule,
    QueueModule,
    DbManagerModule,
  ],
  providers: [CdcRelayGuard, PipelineCdcListener],
  controllers: [CdcRelayController],
})
export class PipelineModule {}
