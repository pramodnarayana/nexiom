import { describe, it, expect, vi, beforeEach } from 'vitest';

import { streamFetcher, getApiUrl, apiClient } from './api-client';

describe('api-client', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('getApiUrl returns the Vite environment variable', () => {
        expect(getApiUrl()).toBe('http://localhost:3000/api');
    });

    it('apiClient is configured with baseURL and withCredentials', () => {
        expect(apiClient.defaults.withCredentials).toBe(true);
        expect(apiClient.defaults.headers['Content-Type']).toBe('application/json');
    });

    it('streamFetcher adds include credentials to request', async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response());
        globalThis.fetch = fetchMock;

        await streamFetcher('http://test.com/stream');

        expect(fetchMock).toHaveBeenCalledWith('http://test.com/stream', expect.objectContaining({
            credentials: 'include'
        }));
    });

    it('streamFetcher triggers auth:unauthorized event on 401 response', async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 401 }));
        globalThis.fetch = fetchMock;
        
        const dispatchEventSpy = vi.spyOn(window, 'dispatchEvent');

        await streamFetcher('http://test.com/stream');

        expect(dispatchEventSpy).toHaveBeenCalledWith(expect.any(CustomEvent));
        expect((dispatchEventSpy.mock.calls[0][0] as CustomEvent).type).toBe('auth:unauthorized');
        
        dispatchEventSpy.mockRestore();
    });
});
