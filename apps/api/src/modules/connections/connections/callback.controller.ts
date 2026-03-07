import { Controller, Get, Req, Res, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ConfigService } from '@nestjs/config';
import {
  ProviderRegistryService,
  type ProviderDefinition,
} from '@nexiom/connectors';

import { OauthStateService } from '../oauth-state.service.js';

export class OAuthCallbackError extends Error {
  constructor(
    public readonly errorCode: string,
    message: string,
  ) {
    super(message);
    this.name = 'OAuthCallbackError';
  }
}

export type PopupPayload =
  | {
      status: 'success';
      provider: string;
      code: string;
      state: string;
      vendorParams?: Record<string, string>;
    }
  | { status: 'error'; error: string };

@Controller('connect/callback')
export class OAuthCallbackController {
  private readonly logger = new Logger(OAuthCallbackController.name);

  private readonly targetOrigin: string;

  constructor(
    private readonly providerRegistry: ProviderRegistryService,
    private readonly oauthStateService: OauthStateService,
    private readonly configService: ConfigService,
  ) {
    const frontendUrl = this.configService.get<string>('FRONTEND_URL');
    if (!frontendUrl) {
      throw new Error(
        'FATAL: FRONTEND_URL is required but not defined in environment variables.',
      );
    }

    try {
      const parsedUrl = new URL(frontendUrl);
      this.targetOrigin = parsedUrl.origin;
    } catch (error_) {
      throw new Error(
        `FATAL: FRONTEND_URL is not a valid URL: ${frontendUrl} — ${String(error_)}`,
      );
    }
  }

  private sendPopupMessage(res: Response, payload: PopupPayload) {
    // Safely serialize and escape the payload to prevent XSS
    const safePayload = JSON.stringify(payload)
      .replaceAll('<', String.raw`\u003c`)
      .replaceAll('>', String.raw`\u003e`)
      .replaceAll('/', String.raw`\u002f`)
      .replaceAll('\u2028', String.raw`\u2028`)
      .replaceAll('\u2029', String.raw`\u2029`);

    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Authenticating...</title>
        </head>
        <body>
          <script>
            try {
              if (window.opener) {
                window.opener.postMessage(${safePayload}, '${this.targetOrigin}');
              } else {
                console.error('No window.opener found to post message to.');
              }
            } catch (error) {
              console.error('Failed to post message to opener:', error);
            }
            window.close();
          </script>
        </body>
      </html>
    `;
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  }

  @Get()
  handleCallback(@Req() req: Request, @Res() res: Response) {
    const rawState = req.query.state as string | undefined;

    if (!rawState) {
      this.logger.warn('Callback missing state parameter');
      return this.sendPopupMessage(res, {
        status: 'error',
        error: 'missing_state',
      });
    }

    let provider: string;
    try {
      provider = this.oauthStateService.extractProviderFromState(rawState);
    } catch (error) {
      this.logger.warn('Failed to extract provider from state', error);
      return this.sendPopupMessage(res, {
        status: 'error',
        error: 'invalid_state',
      });
    }

    if (!/^[a-z0-9-]+$/.test(provider)) {
      this.logger.warn(
        `Rejected invalid provider extracted from state: ${provider}`,
      );
      return this.sendPopupMessage(res, {
        status: 'error',
        error: 'invalid_provider',
      });
    }

    let providerData: ProviderDefinition | null;
    try {
      providerData = this.providerRegistry.getProvider(provider);
      if (!providerData) {
        this.logger.warn(`Rejected unauthorized provider: ${provider}`);
        return this.sendPopupMessage(res, {
          status: 'error',
          error: 'invalid_provider',
        });
      }
    } catch (error) {
      this.logger.error(
        `Provider registry check failed for: ${provider}`,
        error,
      );
      return this.sendPopupMessage(res, {
        status: 'error',
        error: 'internal_error',
      });
    }

    let validatedParams: {
      code: string;
      rawState: string;
      vendorParams: Record<string, string>;
    };
    try {
      validatedParams = this.validateQueryParams(req, provider);
    } catch (error) {
      if (error instanceof OAuthCallbackError) {
        return this.sendPopupMessage(res, {
          status: 'error',
          error: error.errorCode,
        });
      }
      return this.sendPopupMessage(res, {
        status: 'error',
        error: 'internal_error',
      });
    }

    const { code, vendorParams } = validatedParams;

    // 2. Validate State (Tenant Context) using stateless JWT
    try {
      this.oauthStateService.verifyState(rawState, provider);
    } catch (error: unknown) {
      const errMessage = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Missing or invalid OAuth state for provider: ${provider}`,
        errMessage,
      );
      return this.sendPopupMessage(res, {
        status: 'error',
        error: 'invalid_state',
      });
    }

    // Frontend uses popup message to capture code and execute exchange itself
    return this.sendPopupMessage(res, {
      status: 'success',
      provider,
      code,
      state: rawState,
      ...(Object.keys(vendorParams).length > 0 ? { vendorParams } : {}),
    });
  }

  private validateQueryParams(
    req: Request,
    provider: string,
  ): { code: string; rawState: string; vendorParams: Record<string, string> } {
    // Guard against Express passing repeated query params as arrays
    const raw = (key: string) => {
      const val = req.query[key];
      if (Array.isArray(val)) {
        this.logger.warn(
          `Multiple values for query param '${key}' in callback for ${provider}`,
        );
        throw new OAuthCallbackError(
          'invalid_callback',
          `Duplicate query param: ${key}`,
        );
      }
      return val as string | undefined;
    };

    const code = raw('code');
    const rawState = raw('state');
    const errorQuery = raw('error');

    if (errorQuery) {
      this.logger.warn(
        `OAuth vendor returned an error for ${provider}`,
        errorQuery,
      );
      throw new OAuthCallbackError(
        'auth_failed',
        `Vendor error: ${errorQuery}`,
      );
    }

    if (!code || !rawState) {
      this.logger.warn(`Missing code or state in callback for ${provider}`);
      throw new OAuthCallbackError(
        'invalid_callback',
        'Missing required OAuth parameters',
      );
    }

    const vendorParams: Record<string, string> = {};
    for (const key of Object.keys(req.query)) {
      if (key !== 'code' && key !== 'state' && key !== 'error') {
        const val = raw(key);
        if (val) vendorParams[key] = val;
      }
    }

    return { code, rawState, vendorParams };
  }
}
