import { Injectable, InternalServerErrorException } from '@nestjs/common';
import type { OAuthClientPort } from '../../core/ports/outbound/oauth-client.port.js';

@Injectable()
export class HttpOAuthClientAdapter implements OAuthClientPort {
  async exchangeCodeForTokens(
    tokenUrl: string,
    redirectUri: string,
    clientId: string,
    clientSecret: string,
    code: string,
    providerName: string,
    authorizationMethod: 'body' | 'header' = 'body',
  ): Promise<Record<string, unknown>> {
    let response: Response;
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      };

      const params = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
      });

      if (authorizationMethod === 'header') {
        const encoded = Buffer.from(`${clientId}:${clientSecret}`).toString(
          'base64',
        );
        headers['Authorization'] = `Basic ${encoded}`;
      } else {
        params.append('client_id', clientId);
        params.append('client_secret', clientSecret);
      }

      response = await fetch(tokenUrl, {
        method: 'POST',
        headers,
        body: params.toString(),
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

    if (!response.ok) {
      let errorBody = '';
      try {
        errorBody = await response.text();
      } catch {
        // ignore parsing errors
      }

      let sanitizedError = errorBody.replaceAll(/[\r\n]+/g, ' ').trim();
      if (sanitizedError.length > 500) {
        sanitizedError = sanitizedError.substring(0, 500) + '...(truncated)';
      }

      const errorMessage = `Vendor Token Exchange Failed for ${providerName} [${response.status}]: ${sanitizedError}`;

      const error = new Error(errorMessage);
      Object.assign(error, { status: response.status });
      throw error;
    }

    try {
      return (await response.json()) as Record<string, unknown>;
    } catch (_parseError) {
      throw new InternalServerErrorException(
        `Vendor ${providerName} returned an invalid response format that could not be parsed as JSON.`,
      );
    }
  }
}
