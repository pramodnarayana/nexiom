import { Module } from '@nestjs/common';
import { StorageResolverService } from '@nexiom/engine';

@Module({
  providers: [StorageResolverService],
  exports: [StorageResolverService],
})
export class StorageResolverModule {}
