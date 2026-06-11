import { Injectable } from '@nestjs/common';
import type { TriggerStorageResolverPort } from '../../core/ports/outbound/trigger-storage-resolver.port.js';
import { StorageResolverService } from '@soopa/pipeline';

@Injectable()
export class PipelineTriggerStorageResolverAdapter implements TriggerStorageResolverPort {
  constructor(private readonly storageResolver: StorageResolverService) {}

  async resolveSchemaName(dataSourceId: string): Promise<string> {
    return this.storageResolver.resolveSchemaName(dataSourceId);
  }
}
