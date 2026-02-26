import { Injectable, Inject, Logger } from '@nestjs/common';
import {
  OAuthRefreshClient,
  ProviderRegistryService,
  OAuthRefreshError,
  EncryptionService,
} from '@nexiom/connections';
import {
  appConnections,
  AppConnectionStatus,
  withTenantGuard,
  type DrizzleDb,
} from '@nexiom/database';
import { eq, and, desc } from 'drizzle-orm';
import type { ConnectionValueBlob } from '../connectors.service';

@Injectable()
export class DefaultOAuthRefreshClient implements OAuthRefreshClient {
  private readonly logger = new Logger(DefaultOAuthRefreshClient.name);

  constructor(
    private readonly providerRegistry: ProviderRegistryService,
    @Inject('DRIZZLE_DB') private readonly db: DrizzleDb,
    private readonly crypto: EncryptionService,
  ) {}

  async refresh(
    tenantId: string,
    appName: string,
    externalId: string,
    refreshToken: string,
  ): Promise<Record<string, unknown>> {
    const provider = this.providerRegistry.getProvider(appName);
    if (!provider) {
      throw new Error(`Provider not found for refresh: ${appName}`);
    }

    if (provider.authType !== 'OAUTH2' || !provider.tokenUrl) {
      throw new Error(
        `Provider ${appName} does not support OAuth refresh or lacks a token url`,
      );
    }

    try {
      let clientId: string;
      let clientSecret: string;

      try {
        // Fetch the most recent active connection for this tenant + provider.
        // The single-table model stores clientId/clientSecret inside the encrypted value blob.

        const [connection] = await this.db
          .select({ value: appConnections.value })
          .from(appConnections)
          .where(
            withTenantGuard(
              appConnections.tenantId,
              tenantId,
              and(
                eq(appConnections.appName, appName),
                eq(appConnections.externalId, externalId),
                eq(appConnections.status, AppConnectionStatus.ACTIVE),
              ),
            ),
          )
          .orderBy(desc(appConnections.updatedAt), desc(appConnections.id)) // Ensure deterministic resolution
          .limit(1);

        if (!connection) {
          throw new Error(
            `No active connection found for ${appName} on tenant ${tenantId}`,
          );
        }

        const rawEncryptedValue: string = connection.value;
        const decryptedValue = await this.crypto.decrypt(rawEncryptedValue);
        const valueBlob = JSON.parse(decryptedValue) as ConnectionValueBlob;

        if (
          typeof valueBlob.clientId !== 'string' ||
          !valueBlob.clientId.trim() ||
          typeof valueBlob.clientSecret !== 'string' ||
          !valueBlob.clientSecret.trim()
        ) {
          throw new Error(
            'Decrypted credentials missing valid clientId or clientSecret',
          );
        }

        clientId = valueBlob.clientId;
        clientSecret = valueBlob.clientSecret;
      } catch (error: unknown) {
        throw new Error(
          `Failed to retrieve credentials for tenantId=${tenantId} appName=${appName}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      const response = await fetch(provider.tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          client_id: clientId,
          client_secret: clientSecret,
        }).toString(),
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        throw new OAuthRefreshError(
          `OAuth Refresh failed: ${response.status} ${response.statusText || ''}`.trim(),
          response.status,
        );
      }

      return (await response.json()) as Record<string, unknown>;
    } catch (error) {
      if (error instanceof OAuthRefreshError) {
        throw error;
      }
      this.logger.error(
        `[TokenRefresh] Unexpected error for ${appName} on tenant ${tenantId}:`,
        error,
      );
      throw new OAuthRefreshError(
        `Unexpected error during token refresh for ${appName}: ${error instanceof Error ? error.message : String(error)}`,
        500,
      );
    }
  }
}
