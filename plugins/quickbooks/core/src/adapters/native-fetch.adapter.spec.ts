import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NativeFetchAdapter, QuickBooksFetchError } from './native-fetch.adapter.js';

describe('NativeFetchAdapter (QuickBooks)', () => {
    let adapter: NativeFetchAdapter;
    let mockFetch: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        adapter = new NativeFetchAdapter();
        mockFetch = vi.fn();
        global.fetch = mockFetch as any;
    });

    it('should successfully get json data', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({ result: 'ok' })
        });
        const res = await adapter.get('url', {});
        expect(res.status).toBe(200);
        expect(res.data).toEqual({ result: 'ok' });
    });

    it('should successfully get text data', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'text/plain' }),
            text: async () => 'hello'
        });
        const res = await adapter.get('url', {});
        expect(res.data).toBe('hello');
    });

    it('should throw QuickBooksFetchError on get failure', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: false,
            status: 400,
            text: async () => 'Bad Request'
        });
        await expect(adapter.get('url', {})).rejects.toThrow(QuickBooksFetchError);
    });

    it('should successfully post json data', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: true,
            status: 201,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({ created: true })
        });
        const res = await adapter.post('url', {}, { req: 'body' });
        expect(res.status).toBe(201);
        expect(res.data).toEqual({ created: true });
    });

    it('should successfully post text data', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'text/html' }),
            text: async () => '<html></html>'
        });
        const res = await adapter.post('url', {}, {});
        expect(res.data).toBe('<html></html>');
    });

    it('should throw QuickBooksFetchError on post failure', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: false,
            status: 500,
            text: async () => 'Server Error'
        });
        await expect(adapter.post('url', {}, {})).rejects.toThrow(QuickBooksFetchError);
    });
});
