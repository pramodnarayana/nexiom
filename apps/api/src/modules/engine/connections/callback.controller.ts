import { Controller, Get, Req, Res, Logger } from '@nestjs/common';
import { Request, Response } from 'express';
import { db, appConnections } from '@nexiom/database';
import { EncryptionService, ALLOWED_PROVIDERS } from '@nexiom/engine';

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

  constructor(private readonly crypto: EncryptionService) {}

  @Get()
  async handleCallback(@Req() req: Request, @Res() res: Response) {
    const request = req as Request & { session?: GrantSession };
    const provider = request.params.provider;

    if (!ALLOWED_PROVIDERS.has(provider)) {
      this.logger.warn(`Rejected unauthorized provider: ${provider}`);
      res.redirect(`/app/connections?error=invalid_provider`);
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
    } catch (error: unknown) {
      const errMessage = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Missing or invalid OAuth state for provider: ${provider}`,
        errMessage,
      );
      res.redirect(`/app/connections?error=invalid_state`);
      return;
    }

    // 3. Prepare Encrypted Payload
    const credentials = {
      accessToken: grantResponse.access_token,
      refreshToken: grantResponse.refresh_token,
      rawResponse: grantResponse.raw,
    };

    const encryptedPayload = await this.crypto.encrypt(
      JSON.stringify(credentials),
    );

    // 4. Calculate Expiry
    const expiresIn =
      typeof grantResponse.raw?.expires_in === 'number'
        ? grantResponse.raw.expires_in
        : 3600;
    const expiresAt = new Date(Date.now() + expiresIn * 1000);

    // 5. Save to Database using Upsert to prevent duplicate tenant+provider rows
    try {
      await db
        .insert(appConnections)
        .values({
          tenantId,
          appName: provider,
          authType: 'OAUTH2',
          encryptedCredentials: encryptedPayload,
          expiresAt: expiresAt,
          metadata: { realmId: grantResponse.raw?.realmId }, // App-specific metadata extraction
        })
        .onConflictDoUpdate({
          target: [appConnections.tenantId, appConnections.appName],
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
    // });

    res.redirect(`/app/connections?success=true`);
  }
}
