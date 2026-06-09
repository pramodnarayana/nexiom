import { VendorHttpPort, VendorHttpResponse } from '../ports/vendor-http.port.js';

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
  async get<T>(url: string, headers: Record<string, string>, signal?: AbortSignal): Promise<VendorHttpResponse<T>> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const combinedSignal = signal
      ? this.combineSignals(signal, controller.signal)
      : controller.signal;

    try {
      const res = await fetch(url, {
        method: 'GET',
        headers,
        signal: combinedSignal,
      });
      clearTimeout(timeoutId);
    
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

      return {
        status: res.status,
        data,
        headers: responseHeaders,
      };
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }

  async post<T>(url: string, headers: Record<string, string>, body: unknown, signal?: AbortSignal): Promise<VendorHttpResponse<T>> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const combinedSignal = signal
      ? this.combineSignals(signal, controller.signal)
      : controller.signal;

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: combinedSignal,
      });
      clearTimeout(timeoutId);
    
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

      return {
        status: res.status,
        data,
        headers: responseHeaders,
      };
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }

  async patch<T>(url: string, headers: Record<string, string>, body: unknown, signal?: AbortSignal): Promise<VendorHttpResponse<T>> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const combinedSignal = signal
      ? this.combineSignals(signal, controller.signal)
      : controller.signal;

    try {
      const res = await fetch(url, {
        method: 'PATCH',
        headers,
        body: JSON.stringify(body),
        signal: combinedSignal,
      });
      clearTimeout(timeoutId);
    
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

      return {
        status: res.status,
        data,
        headers: responseHeaders,
      };
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }

  private combineSignals(signal1: AbortSignal, signal2: AbortSignal): AbortSignal {
    const controller = new AbortController();

    // Check if either signal is already aborted
    if (signal1.aborted || signal2.aborted) {
      controller.abort();
    }

    const abort = () => controller.abort();
    signal1.addEventListener('abort', abort, { once: true });
    signal2.addEventListener('abort', abort, { once: true });

    return controller.signal;
  }
}
