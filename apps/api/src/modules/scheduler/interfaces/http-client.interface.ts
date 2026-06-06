export const IHttpClient = Symbol('IHttpClient');

export interface IHttpClient {
  /**
   * Dispatches an HTTP request.
   *
   * @param method HTTP method (GET, POST, etc.)
   * @param url Fully qualified URL
   * @param options Optional headers, body, and timeout configuration
   * @returns Resolves with the global Response object.
   */
  request(
    method: string,
    url: string,
    options?: {
      headers?: Record<string, string>;
      body?: unknown;
      timeoutMs?: number;
    },
  ): Promise<Response>;
}
