import { VendorHttpPort, VendorHttpResponse } from '../ports/vendor-http.port.js';

export class FakeHttpAdapter implements VendorHttpPort {
  public getStub: (url: string, headers: Record<string, string>) => Partial<VendorHttpResponse> | Promise<Partial<VendorHttpResponse>> = () => ({ status: 200, data: {}, headers: {} });
  public postStub: (url: string, headers: Record<string, string>, body: unknown) => Partial<VendorHttpResponse> | Promise<Partial<VendorHttpResponse>> = () => ({ status: 200, data: {}, headers: {} });

  async get<T>(url: string, headers: Record<string, string>): Promise<VendorHttpResponse<T>> {
    const res = await this.getStub(url, headers);
    return {
      status: res.status ?? 200,
      data: (res.data ?? {}) as T,
      headers: res.headers ?? {},
    };
  }

  async post<T>(url: string, headers: Record<string, string>, body: unknown): Promise<VendorHttpResponse<T>> {
    const res = await this.postStub(url, headers, body);
    return {
      status: res.status ?? 200,
      data: (res.data ?? {}) as T,
      headers: res.headers ?? {},
    };
  }
}
