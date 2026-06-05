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
    const fetchOptions: RequestInit = {
      method,
      headers: options?.headers,
    };

    if (options?.body !== undefined) {
      fetchOptions.body = JSON.stringify(options.body);
    }

    if (options?.timeoutMs !== undefined) {
      fetchOptions.signal = AbortSignal.timeout(options.timeoutMs);
    }

    return fetch(url, fetchOptions);
  }
}
