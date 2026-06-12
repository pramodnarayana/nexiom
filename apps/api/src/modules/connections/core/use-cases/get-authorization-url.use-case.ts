import { PropertyType } from '@soopa/piece-framework';
import type { OAuth2Auth } from '@soopa/piece-framework';
import type { PieceRegistryPort } from '../ports/outbound/piece-registry.port.js';
import { OAuthUrlBuilder } from '../../oauth-url-builder.js';

export class GetAuthorizationUrlUseCase {
  private readonly oauthUrlBuilder = new OAuthUrlBuilder();

  constructor(
    private readonly pieceRegistry: PieceRegistryPort,
    private readonly baseUrl: string,
  ) {}

  execute(
    providerName: string,
    state: string,
    clientId: string,
    vendorParams: Record<string, string> = {},
  ): string {
    if (!clientId) {
      throw new Error('clientId is required for authorization');
    }

    const auth = this.resolveOAuth2Auth(providerName);

    if (!auth.authUrl) {
      throw new Error(`Provider "${providerName}" missing OAuth2 authorizeUrl`);
    }

    try {
      return this.oauthUrlBuilder.buildAuthorizationUrl({
        authUrl: auth.authUrl,
        clientId,
        state,
        redirectUri: this.oauthUrlBuilder.buildRedirectUri(this.baseUrl),
        scope: auth.scope,
        vendorParams,
      });
    } catch (err) {
      throw new Error(
        err instanceof Error ? err.message : 'Invalid OAuth2 URL template',
      );
    }
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
