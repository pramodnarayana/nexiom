import { Injectable, Inject } from '@nestjs/common';
import type { ExplorerRepositoryPort } from '../../ports/outbound/explorer-repository.port.js';
import type { TraceStorageResolverPort } from '../../ports/outbound/trace-storage-resolver.port.js';

@Injectable()
export class ListObjectsUseCase {
  constructor(
    @Inject('EXPLORER_REPOSITORY_PORT')
    private readonly explorerRepo: ExplorerRepositoryPort,
    @Inject('TRACE_STORAGE_RESOLVER_PORT')
    private readonly storageResolver: TraceStorageResolverPort,
  ) {}

  async execute(
    _orgId: string,
    connectionId: string,
    tab: string,
    _workspaceId?: string,
  ): Promise<string[]> {
    const storageProfile =
      await this.storageResolver.resolveStorageProfile(connectionId);

    return this.explorerRepo.listObjectsByConnection(
      storageProfile.tenantId,
      storageProfile.schemaName,
      connectionId,
      tab,
    );
  }
}
