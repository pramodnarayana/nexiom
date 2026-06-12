import { resolveOAuth2Url } from '@soopa/piece-framework';

export interface BuildAuthorizationUrlParams {
  /** Raw OAuth2 auth URL template (may contain {key} tokens). */
  authUrl: string;
  clientId: string;
  state: string;
  redirectUri: string;
  /** Scopes to request. Omitted from the URL when empty or undefined. */
  scope?: string[];
  /** Vendor-specific tokens used to resolve {key} placeholders in authUrl. */
  vendorParams?: Record<string, string>;
}

/**
 * Pure utility class for constructing OAuth2 URLs.
 *
 * Design goals (TDD-driven):
 *  - Zero NestJS dependencies — fully unit-testable without a DI container.
 *  - No ConfigService — caller supplies the baseUrl at call time.
 *  - No piece registry — caller supplies the resolved auth config.
 *  - All URL-building logic is concentrated here; ConnectorsService delegates.
 *
 * This class follows the Single Responsibility Principle: it builds URLs.
 * It does NOT perform HTTP requests or validate business rules.
 */
export class OAuthUrlBuilder {
  /**
   * Builds the OAuth2 redirect URI from a base URL.
   * Strips trailing slashes before appending the callback path.
   *
   * @param baseUrl  The API base URL (e.g. 'https://api.soopa.com')
   * @returns        Fully qualified redirect URI
   */
  buildRedirectUri(baseUrl: string): string {
    const cleanBase = baseUrl.replace(/\/+$/, '');
    return `${cleanBase}/api/connect/callback`;
  }

  /**
   * Resolves {key} template tokens in an OAuth URL template.
   *
   * Delegates to the piece-framework's `resolveOAuth2Url` so that token
   * resolution rules stay consistent across the platform.
   *
   * @throws  If a required token is present in the template but missing from vendorParams.
   */
  resolveTemplatedUrl(
    template: string,
    vendorParams: Record<string, string>,
  ): string {
    return resolveOAuth2Url(template, vendorParams);
  }

  /**
   * Builds the fully qualified OAuth2 Authorization URL.
   *
   * Includes: response_type, client_id, state, redirect_uri, scope (when non-empty).
   *
   * @throws  BadRequestException-compatible Error when clientId or authUrl is missing.
   */
  buildAuthorizationUrl({
    authUrl,
    clientId,
    state,
    redirectUri,
    scope,
    vendorParams = {},
  }: BuildAuthorizationUrlParams): string {
    if (!clientId) {
      throw new Error('clientId is required for OAuth2 authorization');
    }

    if (!authUrl) {
      throw new Error('authUrl is required for OAuth2 authorization');
    }

    const resolvedAuthUrl = this.resolveTemplatedUrl(authUrl, vendorParams);
    const url = new URL(resolvedAuthUrl);

    url.searchParams.append('response_type', 'code');
    url.searchParams.append('client_id', clientId);
    url.searchParams.append('state', state);

    if (scope && scope.length > 0) {
      url.searchParams.append('scope', scope.join(' '));
    }

    url.searchParams.append('redirect_uri', redirectUri);

    return url.toString();
  }
}
