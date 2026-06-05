import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  BadRequestException,
  HttpException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppCredentialError } from '@soopa/credentials';
import { PropertyType } from '@soopa/piece-framework';
import type { OAuth2Auth } from '@soopa/piece-framework';
import { OAuthUrlBuilder } from '../oauth-url-builder.js';
import { PieceRegistryService } from '@soopa/piece-registry';

@Injectable()
export class OAuthOrchestrationService {
  private readonly logger = new Logger(OAuthOrchestrationService.name);
  private readonly oauthUrlBuilder = new OAuthUrlBuilder();

  constructor(
    private readonly pieceRegistry: PieceRegistryService,
    private readonly configService: ConfigService,
  ) {}

  private buildRedirectUri(): string {
    const rawBaseUrl =
      this.configService.get<string>('BASE_URL') || 'http://localhost:3000';
    return this.oauthUrlBuilder.buildRedirectUri(rawBaseUrl);
  }

  /**
   * Resolves the OAuth2 auth config from the piece registry.
   * Throws NotFoundException if the piece is not registered or is not an OAuth2 piece.
   */
  private resolveOAuth2Auth(providerName: string): OAuth2Auth {
    const piece = this.pieceRegistry.getPiece(providerName);
    if (!piece) {
      throw new NotFoundException(
        `Provider "${providerName}" is not registered`,
      );
    }
    if (piece.auth.type !== PropertyType.OAUTH2) {
      throw new BadRequestException(
        `Provider "${providerName}" does not use OAuth2 authentication`,
      );
    }
    return piece.auth;
  }

  /**
   * Returns the registered piece definition for the given provider name, or null if not found.
   * Used by the controller to look up auth.props for vendorParams schema validation.
   */
  getProviderDefinition(providerName: string) {
    return this.pieceRegistry.getPiece(providerName) ?? null;
  }

  /**
   * Generates the fully qualified Authorization URL for the vendor.
   * Redirects the user's browser to this URL to start the OAuth flow.
   *
   * vendorParams are used to resolve {key} template tokens in the piece's
   * authUrl (e.g. 'https://{environment}.salesforce.com/...').
   */
  getAuthorizationUrl(
    providerName: string,
    state: string,
    clientId: string,
    vendorParams: Record<string, string> = {},
  ): string {
    if (!clientId) {
      throw new BadRequestException('clientId is required for authorization');
    }

    const auth = this.resolveOAuth2Auth(providerName);

    if (!auth.authUrl) {
      throw new InternalServerErrorException(
        `Provider "${providerName}" missing OAuth2 authorizeUrl`,
      );
    }

    try {
      return this.oauthUrlBuilder.buildAuthorizationUrl({
        authUrl: auth.authUrl,
        clientId,
        state,
        redirectUri: this.buildRedirectUri(),
        scope: auth.scope,
        vendorParams,
      });
    } catch (err) {
      throw new BadRequestException(
        err instanceof Error ? err.message : 'Invalid OAuth2 URL template',
      );
    }
  }

  /**
   * Exchanges the OAuth authorization code for real access and refresh tokens.
   *
   * vendorParams are used to resolve {key} template tokens in the piece's
   * tokenUrl (e.g. 'https://{environment}.salesforce.com/...').
   */
  async exchangeCodeForTokens(
    providerName: string,
    code: string,
    clientId: string,
    clientSecret: string,
    vendorParams: Record<string, string> = {},
  ): Promise<Record<string, unknown>> {
    const auth = this.resolveOAuth2Auth(providerName);

    if (!auth.tokenUrl) {
      throw new InternalServerErrorException(
        `Provider "${providerName}" missing OAuth2 tokenUrl`,
      );
    }

    let tokenUrl: string;
    try {
      tokenUrl = this.oauthUrlBuilder.resolveTemplatedUrl(
        auth.tokenUrl,
        vendorParams,
      );
    } catch (err) {
      throw new BadRequestException(
        err instanceof Error ? err.message : 'Invalid OAuth2 URL template',
      );
    }

    const redirectUri = this.buildRedirectUri();

    try {
      this.logger.log(`Exchanging OAuth code for ${providerName}...`);

      const response = await this.executeTokenExchangeFetch(
        tokenUrl,
        redirectUri,
        clientId,
        clientSecret,
        code,
        providerName,
      );

      if (!response.ok) {
        await this.handleTokenExchangeError(providerName, response);
      }

      const tokens = await this.parseTokenResponse(providerName, response);

      if (auth.validateConnectResponse) {
        try {
          auth.validateConnectResponse(tokens);
        } catch (validationError) {
          throw new BadRequestException(
            validationError instanceof Error
              ? validationError.message
              : `Token validation failed for ${providerName}`,
          );
        }
      }

      return tokens;
    } catch (error) {
      this.handleExchangeException(providerName, error);
    }
  }

  private async handleTokenExchangeError(
    providerName: string,
    response: Response,
  ): Promise<never> {
    let errorBody = '';
    try {
      errorBody = await response.text();
    } catch {
      /* ignore parsing errors */
    }

    let sanitizedError = errorBody.replaceAll(/[\r\n]+/g, ' ').trim();
    if (sanitizedError.length > 500) {
      sanitizedError = sanitizedError.substring(0, 500) + '...(truncated)';
    }

    // Log the detailed error (with sanitized vendor response)
    const errorMessage = `Vendor Token Exchange Failed for ${providerName} [${response.status}]: ${sanitizedError}`;
    this.logger.error(errorMessage);

    // Throw generic client-facing messages (without vendor details)
    const genericMessage = `Failed to exchange code with ${providerName}`;
    if (response.status === 400) {
      throw new BadRequestException(genericMessage);
    }
    if (response.status === 401) {
      throw new UnauthorizedException(genericMessage);
    }
    if (response.status >= 400 && response.status < 500) {
      throw new HttpException(genericMessage, response.status);
    }

    throw new InternalServerErrorException(genericMessage);
  }

  private async parseTokenResponse(
    providerName: string,
    response: Response,
  ): Promise<Record<string, unknown>> {
    try {
      return (await response.json()) as Record<string, unknown>;
    } catch (_parseError) {
      this.logger.error(
        `Failed to parse token response from ${providerName} as JSON. Status: ${response.status}, Content-Type: ${response.headers.get('content-type')}`,
        _parseError,
      );
      throw new InternalServerErrorException(
        `Vendor ${providerName} returned an invalid response format that could not be parsed as JSON.`,
      );
    }
  }

  private handleExchangeException(providerName: string, error: unknown): never {
    if (
      error instanceof InternalServerErrorException ||
      error instanceof BadRequestException ||
      error instanceof UnauthorizedException ||
      error instanceof HttpException ||
      error instanceof AppCredentialError
    ) {
      throw error;
    }
    this.logger.error(
      `Exception during OAuth token exchange for ${providerName}`,
      error,
    );
    throw new InternalServerErrorException(
      `Unexpected error during ${providerName} token exchange`,
    );
  }

  private async executeTokenExchangeFetch(
    tokenUrl: string,
    redirectUri: string,
    clientId: string,
    clientSecret: string,
    code: string,
    providerName: string,
  ): Promise<Response> {
    try {
      return await fetch(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirectUri,
          client_id: clientId,
          client_secret: clientSecret,
        }).toString(),
        signal: AbortSignal.timeout(10000),
      });
    } catch (err: unknown) {
      if (
        err instanceof Error &&
        (err.name === 'AbortError' || err.name === 'TimeoutError')
      ) {
        throw new InternalServerErrorException(
          `Token exchange timed out after 10s for ${providerName}`,
        );
      }
      throw err;
    }
  }
}
