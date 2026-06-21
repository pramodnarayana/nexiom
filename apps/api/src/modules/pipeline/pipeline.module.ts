import { Module } from '@nestjs/common';

import { CdcRelayController } from './cdc-relay.controller.js';
import { CdcRelayGuard } from './cdc-relay.guard.js';
import { QueueModule } from '@soopa/queue';
import { StorageResolverModule } from '@soopa/pipeline';
import { DatabaseModule } from '@soopa/database';
import { ObservabilityModule } from '../observability/observability.module.js';

import { DbManagerModule } from '../dbmanager/dbmanager.module.js';

@Module({
  imports: [
    DatabaseModule,
    StorageResolverModule,
    ObservabilityModule,
    QueueModule,
    DbManagerModule,
  ],
  providers: [CdcRelayGuard],
  controllers: [CdcRelayController],
})
export class PipelineModule {}
