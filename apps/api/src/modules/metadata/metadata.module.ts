import { Module } from '@nestjs/common';
import { AuthModule } from '@nexiom/auth';
import { CacheModule } from '@nexiom/cache';
import { DbModule } from '../../db/db.module.js';
import { PiecesModule } from '@nexiom/engine';
import { ConnectionsModule } from '../connections/connections.module.js';
import { MetadataController } from './metadata.controller.js';
import { MetadataDiscoveryService } from './metadata-discovery.service.js';

@Module({
  imports: [DbModule, AuthModule, CacheModule, PiecesModule, ConnectionsModule],
  controllers: [MetadataController],
  providers: [MetadataDiscoveryService],
  exports: [MetadataDiscoveryService],
})
export class MetadataModule {}
