import { Logger } from '@nestjs/common';
import type { AppConnectionRepositoryPort } from '../ports/outbound/app-connection-repository.port.js';
import type { TenantSchemaPort } from '../ports/outbound/tenant-schema.port.js';
import type { StoreOAuthConnectionOptions } from '../types/connection.types.js';

export class StoreOAuthConnectionUseCase {
  constructor(
    private readonly appConnectionRepository: AppConnectionRepositoryPort,
    private readonly tenantSchemaPort: TenantSchemaPort,
    private readonly defaultRegionContext?: string,
  ) {}

  async execute(options: StoreOAuthConnectionOptions): Promise<void> {
    const finalRegionContext =
      options.regionContext || this.defaultRegionContext;

    if (!finalRegionContext) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error(
          'Region context is required for connection storage in production',
        );
      }
      // Warn in non-production environments
      const logger = new Logger(StoreOAuthConnectionUseCase.name);
      logger.warn(
        `No regionContext provided and DEFAULT_REGION_CONTEXT not configured for connection "${options.displayName}" — defaulting to 'unknown'`,
      );
    }

    // 1. Store connection and get ProvisionInfo
    const provisionInfo =
      await this.appConnectionRepository.storeOAuthConnection({
        ...options,
        regionContext: finalRegionContext || 'unknown',
      });

    // 2. Provision Namespace via TenantSchemaPort
    await this.tenantSchemaPort.provisionNamespace(
      options.tenantId,
      provisionInfo,
      options.providerName,
      options.metadata,
    );
  }
}
