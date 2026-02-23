import { Injectable, Logger } from '@nestjs/common';
import {
  OAuthRefreshClient,
  ProviderRegistryService,
  OAuthRefreshError,
} from '@nexiom/connections';
import { ConnectorsService } from '../connectors.service';

@Injectable()
export class DefaultOAuthRefreshClient implements OAuthRefreshClient {
  private readonly logger = new Logger(DefaultOAuthRefreshClient.name);

  constructor(
    private readonly providerRegistry: ProviderRegistryService,
    private readonly connectorsService: ConnectorsService,
  ) {}

  async refresh(
    tenantId: string,
    appName: string,
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
        const credential = await this.connectorsService.fetchAppCredential(
          tenantId,
          appName,
        );

        if (!credential) {
          throw new Error(`Credential not found for ${appName}`);
        }

        clientId = credential.clientId;
        clientSecret = await this.connectorsService.decryptClientSecret(
          credential.encryptedClientSecret,
          appName,
          tenantId,
        );
      } catch (error: unknown) {
        throw new Error(
          `Failed to retrieve app credential for tenantId/appName: ${error instanceof Error ? error.message : String(error)}`,
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
      this.logger.error(`Exception during oauth refresh for ${appName}`, error);
      throw error;
    }
  }
}
