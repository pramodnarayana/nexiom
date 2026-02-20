import {
  Controller,
  Get,
  Req,
  Res,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { db, appConnections } from '@nexiom/database';
// In a real app we would use a real encryption service and context
// import { EncryptionService, TenantContext } from '@nexiom/core-kernel';

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

  // constructor(private crypto: EncryptionService) {}

  @Get()
  async handleCallback(@Req() req: Request, @Res() res: Response) {
    const request = req as Request & { session?: GrantSession };
    const provider = request.params.provider;

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
    const tenantId = rawState; // Mocking decryption for now

    if (!tenantId) {
      throw new BadRequestException('Invalid State/Tenant Context');
    }

    // 3. Prepare Encrypted Payload
    const credentials = {
      accessToken: grantResponse.access_token,
      refreshToken: grantResponse.refresh_token,
      rawResponse: grantResponse.raw,
    };

    const encryptedPayload = Buffer.from(JSON.stringify(credentials)).toString(
      'base64',
    ); // Mock encryption

    // 4. Calculate Expiry
    const expiresIn =
      typeof grantResponse.raw?.expires_in === 'number'
        ? grantResponse.raw.expires_in
        : 3600;
    const expiresAt = new Date(Date.now() + expiresIn * 1000);

    // 5. Save to Database (Strictly within Tenant Context)
    // await TenantContext.run({ tenantId }, async () => {
    try {
      await db.insert(appConnections).values({
        appName: provider,
        authType: 'OAUTH2',
        encryptedCredentials: encryptedPayload,
        expiresAt: expiresAt,
        metadata: { realmId: grantResponse.raw?.realmId }, // App-specific metadata extraction
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
