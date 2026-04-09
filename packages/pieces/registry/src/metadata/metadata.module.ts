import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CacheModule } from '@nexiom/cache';
import { PiecesModule } from '../pieces/pieces.module.js';
import { MetadataDiscoveryService } from './metadata-discovery.service.js';

/**
 * MetadataModule — provides MetadataDiscoveryService.
 *
 * TokenManagerService is NOT provided here. It must be available in the
 * importing application's module context (e.g. via ConnectionsModule in the API).
 * This prevents a circular dependency between the registry package and
 * application-layer modules that own the OAuth refresh client implementation.
 */
@Module({
  imports: [ConfigModule, CacheModule, PiecesModule],
  providers: [MetadataDiscoveryService],
  exports: [MetadataDiscoveryService],
})
export class MetadataModule {}
