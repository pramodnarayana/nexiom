import { Module } from '@nestjs/common';
import { PiecesModule } from '../pieces/pieces.module.js';
import { MetadataDiscoveryService } from './metadata-discovery.service.js';

@Module({
  imports: [PiecesModule],
  providers: [MetadataDiscoveryService],
  exports: [MetadataDiscoveryService],
})
export class MetadataModule {}
