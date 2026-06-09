import { VendorHttpPort, VendorHttpResponse } from '../ports/vendor-http.port.js';

export class QuickBooksFetchError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'QuickBooksFetchError';
  }
}

export class NativeFetchAdapter implements VendorHttpPort {
  async get<T>(url: string, headers: Record<string, string>, signal?: AbortSignal): Promise<VendorHttpResponse<T>> {
    const res = await fetch(url, {
      method: 'GET',
      headers,
      signal,
    });
    
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new QuickBooksFetchError(`QuickBooks API error ${res.status}: ${body}`, res.status);
    }
    
    const contentType = res.headers.get('content-type') || '';
    const isJson = contentType.includes('application/json');
    const data = (isJson ? await res.json() : await res.text()) as T;

    const responseHeaders: Record<string, string> = {};
    res.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    return {
      status: res.status,
      data,
      headers: responseHeaders,
    };
  }

  async post<T>(url: string, headers: Record<string, string>, body: unknown, signal?: AbortSignal): Promise<VendorHttpResponse<T>> {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal,
    });
    
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new QuickBooksFetchError(`QuickBooks API error ${res.status}: ${text}`, res.status);
    }
    
    const contentType = res.headers.get('content-type') || '';
    const isJson = contentType.includes('application/json');
    const data = (isJson ? await res.json() : await res.text()) as T;

    const responseHeaders: Record<string, string> = {};
    res.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    return {
      status: res.status,
      data,
      headers: responseHeaders,
    };
  }
}
