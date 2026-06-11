import { Module } from '@nestjs/common';
import { StorageResolverService } from './storage-resolver.service.js';

// DATABASE_CONNECTION is provided globally by the host application's DbModule.
// StorageResolverService receives it via @Inject(DATABASE_CONNECTION) without
// this module needing to import DbModule directly — keeping the engine package
// host-agnostic and reusable across apps.
@Module({
  providers: [StorageResolverService],
  exports: [StorageResolverService],
})
export class StorageResolverModule {}
