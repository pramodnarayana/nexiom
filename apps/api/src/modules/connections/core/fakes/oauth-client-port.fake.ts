import type { OAuthClientPort } from '../ports/outbound/oauth-client.port.js';

export class FakeOAuthClientPort implements OAuthClientPort {
  public callCount = { exchangeCodeForTokens: 0 };
  public responses = new Map<string, Record<string, unknown>>();

  exchangeCodeForTokens(
    _tokenUrl: string,
    _redirectUri: string,
    _clientId: string,
    _clientSecret: string,
    code: string,
    _providerName: string,
  ): Promise<Record<string, unknown>> {
    this.callCount.exchangeCodeForTokens++;
    const response = this.responses.get(code);
    if (!response) {
      return Promise.reject(
        new Error(`FakeOAuthClientPort: No response mocked for code ${code}`),
      );
    }
    return Promise.resolve(response);
  }

  mockTokenResponse(code: string, response: Record<string, unknown>): void {
    this.responses.set(code, response);
  }
}
