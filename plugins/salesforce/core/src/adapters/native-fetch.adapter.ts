import { VendorHttpPort, VendorHttpResponse } from '../ports/vendor-http.port.js';
import fetch from 'node-fetch';

export class SalesforceFetchError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'SalesforceFetchError';
  }
}

export class NativeFetchAdapter implements VendorHttpPort {
  private getSignal(signal?: AbortSignal): AbortSignal | undefined {
    // If caller provided a signal, use it directly (skip combining to avoid AbortController dependency if possible)
    if (signal) return signal;
    
    // Safely use AbortSignal.timeout if available
    if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
      return AbortSignal.timeout(10000);
    }

    // Safely instantiate AbortController if available
    if (typeof AbortController !== 'undefined') {
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 10000);
      return controller.signal;
    }

    // Fallback: no timeout signal if globals are stripped
    return undefined;
  }

  async get<T>(url: string, headers: Record<string, string>, signal?: AbortSignal): Promise<VendorHttpResponse<T>> {
    const res = await fetch(url, {
      method: 'GET',
      headers,
      signal: this.getSignal(signal),
    });
  
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new SalesforceFetchError(`Salesforce API error ${res.status}: ${body}`, res.status);
    }
    
    const contentType = res.headers.get('content-type') || '';
    const isJson = contentType.includes('application/json');
    const data = (isJson ? await res.json() : await res.text()) as T;

    const responseHeaders: Record<string, string> = {};
    res.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    return { status: res.status, data, headers: responseHeaders };
  }

  async post<T>(url: string, headers: Record<string, string>, body: unknown, signal?: AbortSignal): Promise<VendorHttpResponse<T>> {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: this.getSignal(signal),
    });
  
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new SalesforceFetchError(`Salesforce API error ${res.status}: ${text}`, res.status);
    }
    
    const contentType = res.headers.get('content-type') || '';
    const isJson = contentType.includes('application/json');
    const data = (isJson ? await res.json().catch(() => ({})) : await res.text()) as T;

    const responseHeaders: Record<string, string> = {};
    res.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    return { status: res.status, data, headers: responseHeaders };
  }

  async patch<T>(url: string, headers: Record<string, string>, body: unknown, signal?: AbortSignal): Promise<VendorHttpResponse<T>> {
    const res = await fetch(url, {
      method: 'PATCH',
      headers,
      body: JSON.stringify(body),
      signal: this.getSignal(signal),
    });
  
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new SalesforceFetchError(`Salesforce API error ${res.status}: ${text}`, res.status);
    }
    
    const contentType = res.headers.get('content-type') || '';
    const isJson = contentType.includes('application/json');
    const data = (isJson ? await res.json().catch(() => ({})) : await res.text()) as T;

    const responseHeaders: Record<string, string> = {};
    res.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    return { status: res.status, data, headers: responseHeaders };
  }
}
