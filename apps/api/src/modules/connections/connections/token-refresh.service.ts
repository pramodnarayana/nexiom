import { Injectable, Logger } from '@nestjs/common';
import {
  OAuthRefreshClient,
  ProviderRegistryService,
} from '@nexiom/connections';

@Injectable()
export class DefaultOAuthRefreshClient implements OAuthRefreshClient {
  private readonly logger = new Logger(DefaultOAuthRefreshClient.name);

  constructor(private readonly providerRegistry: ProviderRegistryService) {}

  async refresh(
    appName: string,
    refreshToken: string,
  ): Promise<Record<string, unknown>> {
    const provider = await this.providerRegistry.getProvider(appName);
    if (!provider) {
      throw new Error(`Provider not found for refresh: ${appName}`);
    }

    if (!provider.tokenUrl) {
      throw new Error(
        `Provider ${appName} does not support OAuth refresh or lacks a token url`,
      );
    }

    try {
      const normalizedEnvName = appName
        .replace(/[^A-Za-z0-9]/g, '_')
        .toUpperCase();
      const clientId = process.env[`${normalizedEnvName}_CLIENT_ID`];
      const clientSecret = process.env[`${normalizedEnvName}_CLIENT_SECRET`];

      if (!clientId || !clientSecret) {
        throw new Error(`Missing OAuth client credentials for ${appName}`);
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
        const err = new Error(
          `OAuth Refresh failed: ${response.status} ${response.statusText || ''}`.trim(),
        ) as Error & { status: number };
        err.status = response.status;
        throw err;
      }

      return (await response.json()) as Record<string, unknown>;
    } catch (error) {
      this.logger.error(`Exception during oauth refresh for ${appName}`, error);
      throw error;
    }
  }
}
