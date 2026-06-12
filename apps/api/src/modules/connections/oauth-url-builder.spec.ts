import { describe, it, expect } from 'vitest';
import { OAuthUrlBuilder } from './oauth-url-builder.js';

/**
 * TDD spec for OAuthUrlBuilder — written BEFORE the class exists.
 *
 * This is a pure class with zero NestJS dependencies.
 * No mocks, no module setup — just constructor arguments and pure methods.
 *
 * Contract defined by these tests:
 *  - buildRedirectUri(baseUrl): strips trailing slashes and appends /api/connect/callback
 *  - buildAuthorizationUrl(...): builds full OAuth2 authorization URL with required params
 *  - resolveTemplatedUrl(template, vendorParams): replaces {key} tokens
 */
describe('OAuthUrlBuilder', () => {
  // ─── buildRedirectUri ───────────────────────────────────────────────────────

  describe('buildRedirectUri()', () => {
    it('appends /api/connect/callback to the base URL', () => {
      const builder = new OAuthUrlBuilder();
      expect(builder.buildRedirectUri('https://api.soopa.com')).toBe(
        'https://api.soopa.com/api/connect/callback',
      );
    });

    it('strips a single trailing slash from baseUrl', () => {
      const builder = new OAuthUrlBuilder();
      expect(builder.buildRedirectUri('https://api.soopa.com/')).toBe(
        'https://api.soopa.com/api/connect/callback',
      );
    });

    it('strips multiple trailing slashes from baseUrl', () => {
      const builder = new OAuthUrlBuilder();
      expect(builder.buildRedirectUri('https://api.soopa.com///')).toBe(
        'https://api.soopa.com/api/connect/callback',
      );
    });

    it('works with localhost during development', () => {
      const builder = new OAuthUrlBuilder();
      expect(builder.buildRedirectUri('http://localhost:3000')).toBe(
        'http://localhost:3000/api/connect/callback',
      );
    });
  });

  // ─── resolveTemplatedUrl ────────────────────────────────────────────────────

  describe('resolveTemplatedUrl()', () => {
    it('replaces a single {key} token with the vendor param value', () => {
      const builder = new OAuthUrlBuilder();
      const result = builder.resolveTemplatedUrl(
        'https://{environment}.salesforce.com/oauth2/authorize',
        { environment: 'login' },
      );
      expect(result).toBe('https://login.salesforce.com/oauth2/authorize');
    });

    it('replaces multiple tokens', () => {
      const builder = new OAuthUrlBuilder();
      const result = builder.resolveTemplatedUrl(
        'https://{env}.{region}.example.com/auth',
        { env: 'staging', region: 'us-east-1' },
      );
      expect(result).toBe('https://staging.us-east-1.example.com/auth');
    });

    it('returns the template unchanged when there are no tokens', () => {
      const builder = new OAuthUrlBuilder();
      expect(
        builder.resolveTemplatedUrl('https://example.com/oauth2/authorize', {}),
      ).toBe('https://example.com/oauth2/authorize');
    });

    it('throws when a token is in the template but vendorParams is empty', () => {
      const builder = new OAuthUrlBuilder();
      const template = 'https://{env}.example.com/auth';
      expect(() => builder.resolveTemplatedUrl(template, {})).toThrow();
    });

    it('throws when a required token is missing from vendorParams', () => {
      const builder = new OAuthUrlBuilder();
      expect(() =>
        builder.resolveTemplatedUrl(
          'https://{environment}.salesforce.com/auth',
          {},
        ),
      ).toThrow();
    });
  });

  // ─── buildAuthorizationUrl ─────────────────────────────────────────────────

  describe('buildAuthorizationUrl()', () => {
    const baseParams = {
      authUrl: 'https://login.salesforce.com/services/oauth2/authorize',
      clientId: 'test-client-id',
      state: 'random-csrf-state',
      redirectUri: 'https://api.soopa.com/api/connect/callback',
      scope: ['api', 'refresh_token'],
      vendorParams: {},
    };

    it('includes response_type=code', () => {
      const builder = new OAuthUrlBuilder();
      const url = new URL(builder.buildAuthorizationUrl(baseParams));
      expect(url.searchParams.get('response_type')).toBe('code');
    });

    it('includes client_id', () => {
      const builder = new OAuthUrlBuilder();
      const url = new URL(builder.buildAuthorizationUrl(baseParams));
      expect(url.searchParams.get('client_id')).toBe('test-client-id');
    });

    it('includes state', () => {
      const builder = new OAuthUrlBuilder();
      const url = new URL(builder.buildAuthorizationUrl(baseParams));
      expect(url.searchParams.get('state')).toBe('random-csrf-state');
    });

    it('includes redirect_uri', () => {
      const builder = new OAuthUrlBuilder();
      const url = new URL(builder.buildAuthorizationUrl(baseParams));
      expect(url.searchParams.get('redirect_uri')).toBe(
        'https://api.soopa.com/api/connect/callback',
      );
    });

    it('joins scope with spaces', () => {
      const builder = new OAuthUrlBuilder();
      const url = new URL(builder.buildAuthorizationUrl(baseParams));
      expect(url.searchParams.get('scope')).toBe('api refresh_token');
    });

    it('omits scope param when scope array is empty', () => {
      const builder = new OAuthUrlBuilder();
      const url = new URL(
        builder.buildAuthorizationUrl({ ...baseParams, scope: [] }),
      );
      expect(url.searchParams.has('scope')).toBe(false);
    });

    it('omits scope param when scope is undefined', () => {
      const builder = new OAuthUrlBuilder();
      const url = new URL(
        builder.buildAuthorizationUrl({ ...baseParams, scope: undefined }),
      );
      expect(url.searchParams.has('scope')).toBe(false);
    });

    it('resolves vendorParam tokens in the authUrl', () => {
      const builder = new OAuthUrlBuilder();
      const url = builder.buildAuthorizationUrl({
        ...baseParams,
        authUrl:
          'https://{environment}.salesforce.com/services/oauth2/authorize',
        vendorParams: { environment: 'login' },
      });
      expect(url).toContain('login.salesforce.com');
    });

    it('throws when clientId is empty', () => {
      const builder = new OAuthUrlBuilder();
      expect(() =>
        builder.buildAuthorizationUrl({ ...baseParams, clientId: '' }),
      ).toThrow('clientId is required');
    });

    it('throws when authUrl is empty', () => {
      const builder = new OAuthUrlBuilder();
      expect(() =>
        builder.buildAuthorizationUrl({ ...baseParams, authUrl: '' }),
      ).toThrow();
    });
  });
});
