import { http, HttpResponse } from 'msw';

export const handlers = [
    // Auth Handlers — explicit endpoints only (no catch-all to avoid masking missing routes)
    http.post('*/api/auth/sign-in/email', () => {
        return HttpResponse.json({
            user: {
                id: 'test-user-id',
                email: 'test@example.com',
                name: 'Test User',
                role: 'user',
            },
            session: {
                token: 'test-session-token',
            },
        });
    }),

    http.post('*/api/auth/sign-up/email', () => {
        return HttpResponse.json({
            user: {
                id: 'test-user-id',
                email: 'test@example.com',
                name: 'Test User',
                role: 'user',
            },
            session: {
                token: 'test-session-token',
            },
        });
    }),

    http.post('*/api/auth/sign-out', () => {
        return HttpResponse.json({ success: true });
    }),


    http.get('*/api/auth/session', () => {
        return HttpResponse.json({
            user: {
                id: 'test-user-id',
                email: 'test@example.com',
                name: 'Test User',
                role: 'user',
            },
            session: {
                token: 'test-session-token',
            },
        });
    }),

    http.get('*/api/auth/get-session', () => {
        return HttpResponse.json({
            user: {
                id: 'test-user-id',
                email: 'test@example.com',
                name: 'Test User',
                role: 'user',
            },
            session: {
                token: 'test-session-token',
            },
        });
    }),

    // Full Profile Handler (Required for AuthProvider)
    http.get('*/api/users/me', () => {
        return HttpResponse.json({
            id: 'test-user-id',
            email: 'test@example.com',
            name: 'Test User',
            roles: ['user'],
            permissions: [],
        });
    }),

    // Tenants List Handler
    http.get('*/api/tenants', () => {
        return HttpResponse.json([]);
    }),

    // Organization Handlers
    http.get('*/api/tenants/:id', ({ params }) => {
        return HttpResponse.json({
            id: params.id,
            name: 'Test Organization',
            slug: 'test-org',
        });
    }),

    http.patch('*/api/tenants/:id/details', () => {
        return HttpResponse.json({
            success: true,
        });
    }),
];
