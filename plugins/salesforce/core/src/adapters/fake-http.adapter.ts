import { VendorHttpPort, VendorHttpResponse } from '../ports/vendor-http.port.js';

export class FakeHttpAdapter implements VendorHttpPort {
  public getStub: <T>(url: string, headers?: Record<string, string>) => VendorHttpResponse<T> | Error = () => { throw new Error('Not stubbed'); };
  public postStub: <T>(url: string, body: unknown, headers?: Record<string, string>) => VendorHttpResponse<T> | Error = () => { throw new Error('Not stubbed'); };
  public patchStub: <T>(url: string, body: unknown, headers?: Record<string, string>) => VendorHttpResponse<T> | Error = () => { throw new Error('Not stubbed'); };

  public getCalls: Array<{ url: string; headers: Record<string, string> }> = [];
  public postCalls: Array<{ url: string; headers: Record<string, string>; body: unknown }> = [];
  public patchCalls: Array<{ url: string; headers: Record<string, string>; body: unknown }> = [];

  async get<T>(url: string, headers: Record<string, string>): Promise<VendorHttpResponse<T>> {
    this.getCalls.push({ url, headers });
    const result = this.getStub<T>(url, headers);
    if (result instanceof Error) throw result;
    return result;
  }

  async post<T>(url: string, headers: Record<string, string>, body: unknown): Promise<VendorHttpResponse<T>> {
    this.postCalls.push({ url, headers, body });
    const result = this.postStub<T>(url, body, headers);
    if (result instanceof Error) throw result;
    return result;
  }

  async patch<T>(url: string, headers: Record<string, string>, body: unknown): Promise<VendorHttpResponse<T>> {
    this.patchCalls.push({ url, headers, body });
    const result = this.patchStub<T>(url, body, headers);
    if (result instanceof Error) throw result;
    return result;
  }
}
