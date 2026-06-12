import { Injectable, Inject } from '@nestjs/common';
import type { ExplorerRepositoryPort } from '../../ports/outbound/explorer-repository.port.js';
import type { TraceStorageResolverPort } from '../../ports/outbound/trace-storage-resolver.port.js';

@Injectable()
export class GetConnectionTraceUseCase {
  constructor(
    @Inject('EXPLORER_REPOSITORY_PORT')
    private readonly explorerRepo: ExplorerRepositoryPort,
    @Inject('TRACE_STORAGE_RESOLVER_PORT')
    private readonly storageResolver: TraceStorageResolverPort,
  ) {}

  async execute(
    orgId: string,
    connectionId: string,
    traceId: string,
  ): Promise<{
    inbound: unknown;
    replica: unknown;
    normalized: unknown;
    outbound: unknown;
  }> {
    const storageProfile =
      await this.storageResolver.resolveStorageProfile(connectionId);

    if (storageProfile.tenantId !== orgId) {
      throw new Error('Unauthorized: connection does not belong to organization');
    }

    return this.explorerRepo.getConnectionTrace(
      storageProfile.tenantId,
      storageProfile.schemaName,
      connectionId,
      traceId,
    );
  }
}
