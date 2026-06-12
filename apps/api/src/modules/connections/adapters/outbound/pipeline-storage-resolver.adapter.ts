import { Injectable } from '@nestjs/common';
import type {
  StorageResolverPort,
  ResolvedStorageProfile,
} from '../../core/ports/outbound/storage-resolver.port.js';
import { StorageResolverService } from '@soopa/pipeline';

@Injectable()
export class PipelineStorageResolverAdapter implements StorageResolverPort {
  constructor(
    private readonly storageResolverService: StorageResolverService,
  ) {}

  async resolveStorageProfile(
    dataSourceId: string,
  ): Promise<ResolvedStorageProfile> {
    return this.storageResolverService.resolveStorageProfile(dataSourceId);
  }
}
