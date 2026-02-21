import { Controller, Get, Req, Res, Logger, Inject } from '@nestjs/common';
import { Request, Response } from 'express';
import { appConnections } from '@nexiom/database';
import {
  EncryptionService,
  ProviderRegistryService,
  DrizzleDb,
} from '@nexiom/engine';
import { validate as uuidValidate } from 'uuid';

interface GrantResponse {
  error?: string;
  access_token?: string;
  refresh_token?: string;
  raw?: {
    state?: string;
    expires_in?: number;
    realmId?: string;
    [key: string]: unknown;
  };
}

interface GrantSession {
  grant?: {
    response?: GrantResponse;
  };
}

@Controller('connect/:provider/callback')
export class OAuthCallbackController {
  private readonly logger = new Logger(OAuthCallbackController.name);

  constructor(
    @Inject('DRIZZLE_DB') private readonly db: DrizzleDb,
    private readonly crypto: EncryptionService,
    private readonly providerRegistry: ProviderRegistryService,
  ) {}

  @Get()
  async handleCallback(@Req() req: Request, @Res() res: Response) {
    const request = req as Request & { session?: GrantSession };
    const provider = request.params.provider;

    let providerData;
    try {
      providerData = await this.providerRegistry.getProvider(provider);
      if (!providerData?.enabled) {
        this.logger.warn(`Rejected unauthorized provider: ${provider}`);
        res.redirect(`/app/connections?error=invalid_provider`);
        return;
      }
    } catch (error) {
      this.logger.error(
        `Provider registry check failed for: ${provider}`,
        error,
      );
      res.redirect(`/app/connections?error=internal_error`);
      return;
    }

    // 1. Grant.js populates req.session.grant.response
    const grantResponse = request.session?.grant?.response;
    if (!grantResponse || grantResponse.error) {
      this.logger.error(
        `OAuth failed for ${provider}`,
        grantResponse?.error ?? 'Unknown error',
      );
      res.redirect(`/app/connections?error=auth_failed`);
      return;
    }

    // 2. Extract and Validate State (Tenant Context)
    const rawState = grantResponse.raw?.state;

    let tenantId: string;
    try {
      if (!rawState) throw new Error('Missing state');
      // Using the real encryption service instead of mocking
      tenantId = await this.crypto.decrypt(rawState);
      if (!uuidValidate(tenantId)) throw new Error('Invalid tenant ID format');
    } catch (error: unknown) {
      const errMessage = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Missing or invalid OAuth state for provider: ${provider}`,
        errMessage,
      );
      res.redirect(`/app/connections?error=invalid_state`);
      return;
    }

    // 3. Validate OAuth Payload
    if (!grantResponse.access_token) {
      this.logger.warn(
        `Missing access_token in OAuth response for ${provider}, tenant: ${tenantId}`,
      );
      res.redirect(`/app/connections?error=invalid_credentials`);
      return;
    }

    // 4. Prepare Encrypted Payload
    const credentials = {
      accessToken: grantResponse.access_token,
      refreshToken: grantResponse.refresh_token,
      realmId: grantResponse.raw?.realmId, // Store only needed metadata
    };

    let encryptedPayload: string;
    try {
      encryptedPayload = await this.crypto.encrypt(JSON.stringify(credentials));
    } catch (error) {
      this.logger.error(
        `Encryption failed for ${provider}, tenant: ${tenantId}`,
        error,
      );
      res.redirect(`/app/connections?error=internal_error`);
      return;
    }

    // 5. Calculate Expiry
    const expiresIn =
      typeof grantResponse.raw?.expires_in === 'number' &&
      grantResponse.raw.expires_in > 0
        ? grantResponse.raw.expires_in
        : 3600;
    const expiresAt = new Date(Date.now() + expiresIn * 1000);

    // 6. Derive connectionKey for multi-realm providers (e.g., QuickBooks realmId)
    const connectionKey = grantResponse.raw?.realmId ?? 'default';

    // 7. Save to Database using Upsert to prevent duplicate tenant+provider rows
    try {
      await this.db
        .insert(appConnections)
        .values({
          tenantId,
          providerId: providerData.id,
          appName: provider,
          connectionKey,
          authType: 'OAUTH2',
          encryptedCredentials: encryptedPayload,
          expiresAt: expiresAt,
          metadata: { realmId: grantResponse.raw?.realmId },
        })
        .onConflictDoUpdate({
          target: [
            appConnections.tenantId,
            appConnections.appName,
            appConnections.connectionKey,
          ],
          set: {
            encryptedCredentials: encryptedPayload,
            expiresAt: expiresAt,
            metadata: { realmId: grantResponse.raw?.realmId },
            status: 'ACTIVE',
            updatedAt: new Date(),
          },
        });

      this.logger.log(
        `Successfully stored credentials for ${provider}, tenant: ${tenantId}`,
      );
    } catch (error) {
      this.logger.error(`Failed to store credentials for ${provider}`, error);
      res.redirect(`/app/connections?error=internal_error`);
      return;
    }
    res.redirect(`/app/connections?success=true`);
  }
}
