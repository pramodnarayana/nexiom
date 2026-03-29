import { Module } from '@nestjs/common';
import { ReplicaService } from './replica.service.js';
import { StorageResolverModule } from '@nexiom/engine';
import { DbModule } from '../../db/db.module.js';

@Module({
  imports: [DbModule, StorageResolverModule],
  providers: [ReplicaService],
})
export class PipelineModule {}
