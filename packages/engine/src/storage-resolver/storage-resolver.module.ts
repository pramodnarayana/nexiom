import { Module } from '@nestjs/common';
import { StorageResolverService } from './storage-resolver.service.js';

@Module({
  providers: [StorageResolverService],
  exports: [StorageResolverService],
})
export class StorageResolverModule {}
