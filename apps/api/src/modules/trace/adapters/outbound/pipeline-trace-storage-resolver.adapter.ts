import { Injectable } from '@nestjs/common';
import type {
  TraceStorageResolverPort,
  StorageProfile,
} from '../../core/ports/outbound/trace-storage-resolver.port.js';
import { StorageResolverService } from '@soopa/pipeline';

@Injectable()
export class PipelineTraceStorageResolverAdapter implements TraceStorageResolverPort {
  constructor(private readonly storageResolver: StorageResolverService) {}

  async resolveSchemaName(dataSourceId: string): Promise<string> {
    return this.storageResolver.resolveSchemaName(dataSourceId);
  }

  async resolveStorageProfile(dataSourceId: string): Promise<StorageProfile> {
    return this.storageResolver.resolveStorageProfile(dataSourceId);
  }
}
