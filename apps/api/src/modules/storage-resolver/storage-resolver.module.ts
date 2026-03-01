import { Module } from '@nestjs/common';
import { StorageResolverService } from './storage-resolver.service';

@Module({
  providers: [StorageResolverService],
  exports: [StorageResolverService],
})
export class StorageResolverModule {}
