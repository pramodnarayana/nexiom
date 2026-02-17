import { http, HttpResponse } from 'msw';

export const handlers = [
    // Auth Handlers
    http.post('*/api/auth/*', () => {
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
        console.log('[MSW] Tenant Handler Hit:', params);
        return new HttpResponse(
            JSON.stringify({
                id: params.id,
                name: 'Test Organization',
                slug: 'test-org',
            }),
            {
                headers: {
                    'Content-Type': 'application/json',
                },
            }
        );
    }),

    http.patch('*/api/tenants/:id/details', () => {
        return HttpResponse.json({
            success: true,
        });
    }),
];
