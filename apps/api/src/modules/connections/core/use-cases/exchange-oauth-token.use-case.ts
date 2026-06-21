import { PropertyType } from '@soopa/piece-framework';
import type { OAuth2Auth } from '@soopa/piece-framework';
import type { PieceRegistryPort } from '../ports/outbound/piece-registry.port.js';
import type { OAuthClientPort } from '../ports/outbound/oauth-client.port.js';
import { OAuthUrlBuilder } from '../../oauth-url-builder.js';

export class ExchangeOAuthTokenUseCase {
  private readonly oauthUrlBuilder = new OAuthUrlBuilder();

  constructor(
    private readonly pieceRegistry: PieceRegistryPort,
    private readonly oauthClient: OAuthClientPort,
    private readonly baseUrl: string,
  ) {}

  async execute(
    providerName: string,
    code: string,
    clientId: string,
    clientSecret: string,
    vendorParams: Record<string, string> = {},
  ): Promise<Record<string, unknown>> {
    const auth = this.resolveOAuth2Auth(providerName);

    if (!auth.tokenUrl) {
      throw new Error(`Provider "${providerName}" missing OAuth2 tokenUrl`);
    }

    let tokenUrl: string;
    try {
      tokenUrl = this.oauthUrlBuilder.resolveTemplatedUrl(
        auth.tokenUrl,
        vendorParams,
      );
    } catch (err) {
      throw new Error(
        err instanceof Error ? err.message : 'Invalid OAuth2 URL template',
      );
    }

    const redirectUri = this.oauthUrlBuilder.buildRedirectUri(this.baseUrl);

    const tokens = await this.oauthClient.exchangeCodeForTokens(
      tokenUrl,
      redirectUri,
      clientId,
      clientSecret,
      code,
      providerName,
      auth.authorizationMethod,
    );

    if (auth.validateConnectResponse) {
      auth.validateConnectResponse(tokens);
    }

    return tokens;
  }

  private resolveOAuth2Auth(providerName: string): OAuth2Auth {
    const piece = this.pieceRegistry.getPiece(providerName);
    if (!piece) {
      throw new Error(`Provider "${providerName}" is not registered`);
    }
    if (piece.auth.type !== PropertyType.OAUTH2) {
      throw new Error(
        `Provider "${providerName}" does not use OAuth2 authentication`,
      );
    }
    return piece.auth;
  }
}
