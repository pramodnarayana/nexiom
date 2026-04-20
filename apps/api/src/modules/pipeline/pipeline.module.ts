import { Module } from '@nestjs/common';
import { ReplicaService } from './replica.service.js';
import { CdcRelayController } from './cdc-relay.controller.js';
import { CdcRelayGuard } from './cdc-relay.guard.js';
import { QueueModule } from '@nexiom/queue';
import { StorageResolverModule } from '@nexiom/engine';
import { DbModule } from '../../db/db.module.js';
import { ObservabilityModule } from '../observability/observability.module.js';

@Module({
  imports: [DbModule, StorageResolverModule, ObservabilityModule, QueueModule],
  providers: [ReplicaService, CdcRelayGuard],
  controllers: [CdcRelayController],
})
export class PipelineModule {}
