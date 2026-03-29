import { Module } from '@nestjs/common';
import { ReplicaService } from './replica.service.js';
import { StorageResolverModule } from '@nexiom/engine';
import { DbModule } from '../../db/db.module.js';
import { ObservabilityModule } from '../observability/observability.module.js';

@Module({
  imports: [DbModule, StorageResolverModule, ObservabilityModule],
  providers: [ReplicaService],
})
export class PipelineModule {}
