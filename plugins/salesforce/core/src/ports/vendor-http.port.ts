export interface VendorHttpResponse<T = unknown> {
  status: number;
  data: T;
  headers: Record<string, string>;
}

export interface VendorHttpPort {
  get<T>(url: string, headers: Record<string, string>, signal?: AbortSignal): Promise<VendorHttpResponse<T>>;
  post<T>(url: string, headers: Record<string, string>, body: unknown, signal?: AbortSignal): Promise<VendorHttpResponse<T>>;
}
