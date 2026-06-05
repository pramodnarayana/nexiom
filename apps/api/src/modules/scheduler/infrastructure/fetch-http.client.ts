import { Injectable } from '@nestjs/common';
import { IHttpClient } from '../interfaces/http-client.interface.js';

@Injectable()
export class FetchHttpClient implements IHttpClient {
  async request(
    method: string,
    url: string,
    options?: {
      headers?: Record<string, string>;
      body?: unknown;
      timeoutMs?: number;
    },
  ): Promise<Response> {
    const headers: Record<string, string> = options?.headers || {};

    const fetchOptions: RequestInit = {
      method,
      headers,
    };

    if (options?.body !== undefined) {
      fetchOptions.body = JSON.stringify(options.body);
      // Set Content-Type: application/json header if not already set
      if (!headers['Content-Type'] && !headers['content-type']) {
        headers['Content-Type'] = 'application/json';
      }
    }

    if (options?.timeoutMs !== undefined) {
      fetchOptions.signal = AbortSignal.timeout(options.timeoutMs);
    }

    return fetch(url, fetchOptions);
  }
}
