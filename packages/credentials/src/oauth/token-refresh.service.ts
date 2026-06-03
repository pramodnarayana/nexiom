import { Injectable, Logger } from '@nestjs/common';
import { OAuthRefreshClient, OAuthRefreshError } from './token-manager.service.js';
import { EncryptionService } from '../crypto/encryption.interface.js';
import { resolveOAuth2Url } from '@soopa/piece-framework';
import {
  dataSources,
  credentials,
  AppConnectionStatus,
  withTenantGuard,
  type DrizzleDb,
} from '@soopa/database';
import { eq, and, desc } from 'drizzle-orm';

@Injectable()
export abstract class BaseOAuthRefreshClient implements OAuthRefreshClient {
  private readonly logger = new Logger(BaseOAuthRefreshClient.name);

  constructor(
    protected readonly db: DrizzleDb,
    protected readonly crypto: EncryptionService,
  ) {}

  protected abstract getTokenUrl(appName: string): string | Promise<string>;

  async refresh(
    tenantId: string,
    appName: string,
    externalId: string,
    refreshToken: string,
  ): Promise<Record<string, unknown>> {
    try {
      this.validateInputs(tenantId, appName, externalId, refreshToken);
      const tokenUrl = await this.getTokenUrl(appName);
      const { clientId, clientSecret, vendorParams } = await this.getCredentials(tenantId, appName, externalId);
      const resolvedTokenUrl = resolveOAuth2Url(tokenUrl, vendorParams);
      const response = await fetch(resolvedTokenUrl, {
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
        throw new OAuthRefreshError(`OAuth Refresh failed: ${response.status} ${response.statusText || ''}`.trim(), response.status);
      }
      const parsed = await response.json();
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new OAuthRefreshError(`OAuth token response must be a non-null object, received: ${Array.isArray(parsed) ? 'array' : typeof parsed}`, 500);
      }
      return parsed as Record<string, unknown>;
    } catch (error) {
      if (error instanceof OAuthRefreshError) throw error;
      if (error instanceof TypeError) {
        throw new OAuthRefreshError(`Invalid refresh input: ${error.message}`, 400);
      }
      this.logger.error(`[TokenRefresh] Unexpected error for ${appName} on tenant ${tenantId}:`, error);
      throw new OAuthRefreshError(`Unexpected error during token refresh for ${appName}: ${error instanceof Error ? error.message : String(error)}`, 500);
    }
  }

  private validateInputs(tenantId: string, appName: string, externalId: string, refreshToken: string): void {
    if (typeof tenantId !== 'string' || !tenantId.trim()) throw new TypeError('Invalid refresh input: tenantId');
    if (typeof appName !== 'string' || !appName.trim()) throw new TypeError('Invalid refresh input: appName');
    if (typeof externalId !== 'string' || !externalId.trim()) throw new TypeError('Invalid refresh input: externalId');
    if (typeof refreshToken !== 'string' || !refreshToken.trim()) throw new TypeError('Invalid refresh input: refreshToken');
  }

  private async getCredentials(tenantId: string, appName: string, externalId: string): Promise<{ clientId: string; clientSecret: string; vendorParams: Record<string, string>; }> {
    try {
      const [connection] = await this.db.select({ value: credentials.value }).from(dataSources).innerJoin(credentials, eq(credentials.dataSourceId, dataSources.id)).where(
        withTenantGuard(dataSources.tenantId, tenantId, and(eq(dataSources.appName, appName), eq(dataSources.externalId, externalId), eq(credentials.status, AppConnectionStatus.ACTIVE)))
      ).orderBy(desc(dataSources.updatedAt), desc(dataSources.id)).limit(1);
      if (!connection) throw new Error(`No active connection found for ${appName} on tenant ${tenantId}`);
      const rawEncryptedValue: string = connection.value;
      const decryptedValue = await this.crypto.decrypt(rawEncryptedValue);
      const valueBlob = JSON.parse(decryptedValue);
      if (typeof valueBlob !== 'object' || valueBlob === null || Array.isArray(valueBlob)) {
        throw new Error('Invalid credential payload: expected a non-null plain object');
      }
      if (typeof valueBlob.clientId !== 'string' || !valueBlob.clientId.trim() || typeof valueBlob.clientSecret !== 'string' || !valueBlob.clientSecret.trim()) {
        throw new Error('Decrypted credentials missing valid clientId or clientSecret');
      }
      const vendorParamsSpread = typeof valueBlob.vendorParams === 'object' && valueBlob.vendorParams !== null && !Array.isArray(valueBlob.vendorParams) ? valueBlob.vendorParams : {};
      const environmentEntry = 'environment' in valueBlob && valueBlob.environment ? { environment: String(valueBlob.environment) } : {};
      return {
        clientId: valueBlob.clientId,
        clientSecret: valueBlob.clientSecret,
        vendorParams: {
          ...vendorParamsSpread,
          ...environmentEntry,
        },
      };
    } catch (error: unknown) {
      throw new Error(`Failed to retrieve credentials for tenantId=${tenantId} appName=${appName} externalId=${externalId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
