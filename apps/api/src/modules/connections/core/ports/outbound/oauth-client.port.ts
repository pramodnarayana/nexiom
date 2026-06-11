export interface OAuthClientPort {
  /**
   * Exchanges the OAuth authorization code for real access and refresh tokens.
   */
  exchangeCodeForTokens(
    tokenUrl: string,
    redirectUri: string,
    clientId: string,
    clientSecret: string,
    code: string,
    providerName: string,
  ): Promise<Record<string, unknown>>;
}
