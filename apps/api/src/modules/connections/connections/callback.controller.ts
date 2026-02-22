import { Controller, Get, Req, Res, Logger, Inject } from '@nestjs/common';
import { Request, Response } from 'express';
import { appConnections, type providers } from '@nexiom/database';
import type { InferSelectModel } from 'drizzle-orm';
import {
  EncryptionService,
  ProviderRegistryService,
  DrizzleDb,
} from '@nexiom/connections';

import { OauthStateService } from '../oauth-state.service';
import { ConnectorsService } from '../connectors.service';

@Controller('connect/:provider/callback')
export class OAuthCallbackController {
  private readonly logger = new Logger(OAuthCallbackController.name);

  constructor(
    @Inject('DRIZZLE_DB') private readonly db: DrizzleDb,
    private readonly crypto: EncryptionService,
    private readonly providerRegistry: ProviderRegistryService,
    private readonly oauthStateService: OauthStateService,
    private readonly connectorsService: ConnectorsService,
  ) {}

  @Get()
  async handleCallback(@Req() req: Request, @Res() res: Response) {
    const request = req;
    const provider = request.params.provider;

    let providerData: InferSelectModel<typeof providers> | null;
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

    // 1. Extract and Validate query parameters
    const code = req.query.code as string;
    const rawState = req.query.state as string;
    const errorQuery = req.query.error as string;

    if (errorQuery) {
      this.logger.error(
        `OAuth vendor returned an error for ${provider}`,
        errorQuery,
      );
      return res.redirect(`/app/connections?error=auth_failed`);
    }

    if (!code || !rawState) {
      this.logger.warn(`Missing code or state in callback for ${provider}`);
      return res.redirect(`/app/connections?error=invalid_callback`);
    }

    // 2. Validate State (Tenant Context) using stateless JWT
    let tenantId: string;
    try {
      const stateData = this.oauthStateService.verifyState(rawState, provider);
      tenantId = stateData.tenantId;
    } catch (error: unknown) {
      const errMessage = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Missing or invalid OAuth state for provider: ${provider}`,
        errMessage,
      );
      res.redirect(`/app/connections?error=invalid_state`);
      return;
    }

    // 3. Exchange code for real tokens
    let tokenResponse: Record<string, unknown>;
    try {
      tokenResponse = await this.connectorsService.exchangeCodeForTokens(
        provider,
        code,
      );
    } catch (error) {
      this.logger.error(`Token exchange failed for ${provider}`, error);
      return res.redirect(`/app/connections?error=internal_error`);
    }

    if (!tokenResponse.access_token) {
      this.logger.warn(
        `Missing access_token in OAuth response for ${provider}, tenant: ${tenantId}`,
      );
      return res.redirect(`/app/connections?error=invalid_credentials`);
    }

    // 4. Prepare Encrypted Payload
    const credentials = {
      accessToken: tokenResponse.access_token as string,
      refreshToken: tokenResponse.refresh_token as string | undefined,
      realmId: req.query.realmId as string | undefined, // Common for QuickBooks/accounting
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
    let expiresIn = 3600; // default 1 hour
    if (
      typeof tokenResponse.expires_in === 'number' &&
      tokenResponse.expires_in > 0
    ) {
      expiresIn = tokenResponse.expires_in;
    } else if (
      typeof tokenResponse.expires_in === 'string' &&
      Number.parseInt(tokenResponse.expires_in, 10) > 0
    ) {
      expiresIn = Number.parseInt(tokenResponse.expires_in, 10);
    }
    const expiresAt = new Date(Date.now() + expiresIn * 1000);

    // 6. Derive connectionKey (e.g. for multiple environments)
    const connectionKey = (req.query.realmId as string) || 'default';

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
          metadata: { realmId: req.query.realmId as string | undefined },
        })
        .onConflictDoUpdate({
          target: [
            appConnections.tenantId,
            appConnections.appName,
            appConnections.connectionKey,
          ],
          set: {
            providerId: providerData.id,
            encryptedCredentials: encryptedPayload,
            expiresAt: expiresAt,
            metadata: { realmId: req.query.realmId as string | undefined },
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
