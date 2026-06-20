import { Logger } from '@nestjs/common';
import type { AppConnectionRepositoryPort } from '../ports/outbound/app-connection-repository.port.js';
import type { ConnectionLifecyclePort } from '../ports/outbound/connection-lifecycle.port.js';
import type { StoreOAuthConnectionOptions } from '../types/connection.types.js';
import { ENCRYPTION_SERVICE, type IEncryptionService } from '@soopa/security';

export class StoreOAuthConnectionUseCase {
  constructor(
    private readonly appConnectionRepository: AppConnectionRepositoryPort,
    private readonly connectionLifecyclePort: ConnectionLifecyclePort,
    private readonly crypto: IEncryptionService,
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

    const stringifiedValue =
      typeof options.value === 'string'
        ? options.value
        : JSON.stringify(options.value);
    const encryptedValue = await this.crypto.encrypt(stringifiedValue);

    // 1. Store connection and get ProvisionInfo
    const provisionInfo =
      await this.appConnectionRepository.storeOAuthConnection({
        ...options,
        value: encryptedValue,
        regionContext: finalRegionContext || 'unknown',
      });

    // 2. Activate connection and enqueue provisioning
    await this.connectionLifecyclePort.activateAndProvision(
      options.tenantId,
      provisionInfo,
      options.providerName,
      options.metadata,
    );
  }
}
