export enum HttpMethod {
    GET = 'GET',
    POST = 'POST',
    PUT = 'PUT',
    PATCH = 'PATCH',
    DELETE = 'DELETE',
    HEAD = 'HEAD',
}

export interface HttpRequest {
    method: HttpMethod;
    url: string;
    headers?: Record<string, string>;
    body?: any;
    queryParams?: Record<string, string>;
    responseType?: any;
    authentication?: {
        type: string;
        token: string;
    };
}

export interface HttpResponse<T = any> {
    status: number;
    headers: Record<string, string>;
    body: T;
}

export interface HttpClient {
    sendRequest<T = any>(request: HttpRequest): Promise<HttpResponse<T>>;
}

let _httpClientInstance: HttpClient | null = null;

export function initializeHttpClient(client: HttpClient) {
    _httpClientInstance = client;
}

export const httpClient = new Proxy({} as HttpClient, {
    get: (_target, prop) => {
        if (!_httpClientInstance) {
            throw new Error('HttpClient accessed before platform initialization');
        }
        const value = (_httpClientInstance as any)[prop];
        if (typeof value === 'function') {
            return value.bind(_httpClientInstance);
        }
        return value;
    }
});
