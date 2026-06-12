import { Injectable, Inject, BadRequestException } from '@nestjs/common';
import type {
  ExplorerRepositoryPort,
  ExplorerPage,
} from '../../ports/outbound/explorer-repository.port.js';
import type { TraceStorageResolverPort } from '../../ports/outbound/trace-storage-resolver.port.js';

@Injectable()
export class ListConnectionDataUseCase {
  constructor(
    @Inject('EXPLORER_REPOSITORY_PORT')
    private readonly explorerRepo: ExplorerRepositoryPort,
    @Inject('TRACE_STORAGE_RESOLVER_PORT')
    private readonly storageResolver: TraceStorageResolverPort,
  ) {}

  private safePagination(page: number, limit: number) {
    const numPage = Number(page);
    const numLimit = Number(limit);

    const safePage = Number.isFinite(numPage)
      ? Math.max(1, Math.trunc(numPage))
      : 1;
    const safeLimit = Number.isFinite(numLimit)
      ? Math.min(Math.max(1, Math.trunc(numLimit)), 100)
      : 100;

    return { safePage, safeLimit };
  }

  async execute(
    _orgId: string,
    connectionId: string,
    tab: string,
    page: number,
    limit: number,
    _workspaceId?: string,
    objectType?: string,
    filters?: import('../../../filter-parser.js').FilterGroup,
  ): Promise<ExplorerPage<any>> {
    const { safePage, safeLimit } = this.safePagination(page, limit);
    const storageProfile =
      await this.storageResolver.resolveStorageProfile(connectionId);

    switch (tab) {
      case 'inbound':
        return this.explorerRepo.listConnectionInbound(
          storageProfile.tenantId,
          storageProfile.schemaName,
          connectionId,
          safePage,
          safeLimit,
          objectType,
          filters,
        );
      case 'replica':
        return this.explorerRepo.listConnectionReplica(
          storageProfile.tenantId,
          storageProfile.schemaName,
          connectionId,
          safePage,
          safeLimit,
          objectType,
          filters,
        );
      case 'normalized':
        return this.explorerRepo.listConnectionNormalized(
          storageProfile.tenantId,
          storageProfile.schemaName,
          connectionId,
          safePage,
          safeLimit,
          objectType,
          filters,
        );
      case 'outbound':
        return this.explorerRepo.listConnectionOutbound(
          storageProfile.tenantId,
          storageProfile.schemaName,
          connectionId,
          safePage,
          safeLimit,
        );
      default:
        throw new BadRequestException(`Invalid tab: ${tab}`);
    }
  }
}
