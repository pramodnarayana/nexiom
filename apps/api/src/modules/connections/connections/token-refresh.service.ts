import { Injectable, Inject, Logger } from '@nestjs/common';
import {
  OAuthRefreshClient,
  OAuthRefreshError,
  EncryptionService,
} from '@nexiom/credentials';
import { PropertyType, resolveOAuth2Url } from '@nexiom/piece-framework';
import {
  appConnections,
  AppConnectionStatus,
  withTenantGuard,
  DATABASE_CONNECTION, // Added DATABASE_CONNECTION here
  type DrizzleDb,
} from '@nexiom/database';
import { eq, and, desc } from 'drizzle-orm';
import type { ConnectionValueBlob } from '../connectors.service.js';
import { PieceRegistryService } from '@nexiom/engine';

@Injectable()
export class DefaultOAuthRefreshClient implements OAuthRefreshClient {
  private readonly logger = new Logger(DefaultOAuthRefreshClient.name);

  constructor(
    private readonly pieceRegistry: PieceRegistryService,
    @Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb,
    private readonly crypto: EncryptionService,
  ) {}

  async refresh(
    tenantId: string,
    appName: string,
    externalId: string,
    refreshToken: string,
  ): Promise<Record<string, unknown>> {
    this.validateInputs(tenantId, appName, externalId, refreshToken);

    const piece = this.pieceRegistry.getPiece(appName);
    if (!piece) {
      throw new Error(`Piece not found for refresh: ${appName}`);
    }

    if (piece.auth?.type !== PropertyType.OAUTH2 || !piece.auth.tokenUrl) {
      throw new Error(
        `Piece ${appName} does not support OAuth refresh or lacks a token url`,
      );
    }

    try {
      const { clientId, clientSecret, vendorParams } =
        await this.getCredentials(tenantId, appName, externalId);

      const resolvedTokenUrl = resolveOAuth2Url(
        piece.auth.tokenUrl,
        vendorParams,
      );

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

  private validateInputs(
    tenantId: string,
    appName: string,
    externalId: string,
    refreshToken: string,
  ): void {
    if (typeof tenantId !== 'string' || !tenantId.trim()) {
      throw new TypeError(
        'Invalid refresh input: tenantId is missing or empty',
      );
    }
    if (typeof appName !== 'string' || !appName.trim()) {
      throw new TypeError('Invalid refresh input: appName is missing or empty');
    }
    if (typeof externalId !== 'string' || !externalId.trim()) {
      throw new TypeError(
        'Invalid refresh input: externalId is missing or empty',
      );
    }
    if (typeof refreshToken !== 'string' || !refreshToken.trim()) {
      throw new TypeError(
        'Invalid refresh input: refreshToken is missing or empty',
      );
    }
  }

  private async getCredentials(
    tenantId: string,
    appName: string,
    externalId: string,
  ): Promise<{
    clientId: string;
    clientSecret: string;
    vendorParams: Record<string, string>;
  }> {
    try {
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
        .orderBy(desc(appConnections.updatedAt), desc(appConnections.id))
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

      return {
        clientId: valueBlob.clientId,
        clientSecret: valueBlob.clientSecret,
        vendorParams: {
          ...(valueBlob.vendorParams ?? {}),
          ...('environment' in valueBlob && valueBlob.environment
            ? { environment: String(valueBlob.environment) }
            : {}),
        },
      };
    } catch (error: unknown) {
      throw new Error(
        `Failed to retrieve credentials for tenantId=${tenantId} appName=${appName}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
