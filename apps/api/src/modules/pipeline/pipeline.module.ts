import { Module } from '@nestjs/common';

import { CdcRelayController } from './cdc-relay.controller.js';
import { CdcRelayGuard } from './cdc-relay.guard.js';
import { QueueModule } from '@soopa/queue';
import { StorageResolverModule } from '@soopa/engine';
import { DbModule } from '../../db/db.module.js';
import { ObservabilityModule } from '../observability/observability.module.js';

@Module({
  imports: [DbModule, StorageResolverModule, ObservabilityModule, QueueModule],
  providers: [CdcRelayGuard],
  controllers: [CdcRelayController],
})
export class PipelineModule {}
