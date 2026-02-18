import { describe, it, expect, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/mocks/server';
import { authorizedFetch } from './api';

describe('api - authorizedFetch', () => {
    beforeEach(() => {
        server.resetHandlers();
    });

    it('makes successful GET request and returns JSON', async () => {
        server.use(
            http.get('http://localhost:3000/api/users', () => {
                return HttpResponse.json({ data: 'test' });
            })
        );

        const result = await authorizedFetch('/users');
        expect(result).toEqual({ data: 'test' });
    });

    it('includes Authorization header when token is provided', async () => {
        let receivedHeaders: Headers | undefined;

        server.use(
            http.get('http://localhost:3000/api/users', ({ request }) => {
                receivedHeaders = request.headers;
                return HttpResponse.json({ success: true });
            })
        );

        await authorizedFetch('/users', {}, 'test-token');

        expect(receivedHeaders).toBeDefined();
        expect(receivedHeaders?.get('Authorization')).toBe('Bearer test-token');
    });

    it('sets default Content-Type to application/json', async () => {
        let receivedHeaders: Headers | undefined;

        server.use(
            http.get('http://localhost:3000/api/users', ({ request }) => {
                receivedHeaders = request.headers;
                return HttpResponse.json({});
            })
        );

        await authorizedFetch('/users');

        expect(receivedHeaders?.get('Content-Type')).toBe('application/json');
    });

    it('does not override existing Content-Type header', async () => {
        let receivedHeaders: Headers | undefined;

        server.use(
            http.post('http://localhost:3000/api/upload', ({ request }) => {
                receivedHeaders = request.headers;
                return HttpResponse.json({});
            })
        );

        await authorizedFetch('/upload', {
            method: 'POST',
            headers: { 'Content-Type': 'multipart/form-data' },
        });

        expect(receivedHeaders?.get('Content-Type')).toBe('multipart/form-data');
    });

    it('throws error when response is not ok and has JSON error message', async () => {
        server.use(
            http.get('http://localhost:3000/api/users', () => {
                return HttpResponse.json(
                    { message: 'Invalid input' },
                    { status: 400 }
                );
            })
        );

        await expect(authorizedFetch('/users')).rejects.toThrow('Invalid input');
    });

    it('throws error with fallback message when response is not JSON', async () => {
        server.use(
            http.get('http://localhost:3000/api/users', () => {
                return new HttpResponse('Internal Server Error', {
                    status: 500,
                    statusText: 'Internal Server Error',
                });
            })
        );

        await expect(authorizedFetch('/users')).rejects.toThrow('Unknown Error');
    });

    it('handles POST request with body', async () => {
        let receivedBody: unknown = null;

        server.use(
            http.post('http://localhost:3000/api/users', async ({ request }) => {
                receivedBody = await request.json();
                return HttpResponse.json({ id: '123' });
            })
        );

        const body = { name: 'Test User' };
        const result = await authorizedFetch('/users', {
            method: 'POST',
            body: JSON.stringify(body),
        });

        expect(receivedBody).toEqual(body);
        expect(result).toEqual({ id: '123' });
    });

    // credentials: 'include' is hardcoded in the implementation (api.ts).
    // MSW Node handlers cannot reliably expose request.credentials, so this
    // is not testable at the unit level and is omitted intentionally.
});
