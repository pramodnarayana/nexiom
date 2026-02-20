import { Injectable, Logger } from '@nestjs/common';
import { OAuthRefreshClient, ProviderRegistryService } from '@nexiom/engine';

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
      const response = await fetch(provider.tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          client_id: process.env[`${appName.toUpperCase()}_CLIENT_ID`] || '',
          client_secret:
            process.env[`${appName.toUpperCase()}_CLIENT_SECRET`] || '',
        }).toString(),
      });

      if (!response.ok) {
        const errorPayload = await response.text();
        this.logger.error(
          `OAuth Refresh failed for ${appName}: ${errorPayload}`,
        );
        // If 400 or 401, throwing an object with status will trigger REVOKED status in TokenManager
        const err = new Error(
          `OAuth Refresh failed: ${response.status}`,
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
