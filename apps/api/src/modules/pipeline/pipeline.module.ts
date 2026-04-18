import { Module } from '@nestjs/common';
import { ReplicaService } from './replica.service.js';
import { ReplicaOutboxService } from './replica-outbox.service.js';
import { InboundOutboxService } from './inbound-outbox.service.js';
import { QueueModule } from '@nexiom/queue';
import { StorageResolverModule } from '@nexiom/engine';
import { DbModule } from '../../db/db.module.js';
import { ObservabilityModule } from '../observability/observability.module.js';

@Module({
  imports: [DbModule, StorageResolverModule, ObservabilityModule, QueueModule],
  providers: [ReplicaService, ReplicaOutboxService, InboundOutboxService],
})
export class PipelineModule {}
