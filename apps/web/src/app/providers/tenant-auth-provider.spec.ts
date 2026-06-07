import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { tenantAuthProvider } from './tenant-auth-provider';
import { authClient } from '@/shared/lib/auth-client';

// Mock authClient
vi.mock('@/shared/lib/auth-client', () => ({
    authClient: {
        signIn: {
            email: vi.fn(),
        },
        signOut: vi.fn(),
        getSession: vi.fn(),
    },
}));

describe('tenantAuthProvider', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('login', () => {
        it('returns success and redirects to dashboard on successful login', async () => {
            vi.mocked(authClient.signIn.email).mockResolvedValueOnce({
                data: { user: { id: '1', email: 'test@example.com' } },
                error: null,
            });

            const result = await tenantAuthProvider.login({
                email: 'test@example.com',
                password: 'password123',
            });

            expect(result).toEqual({
                success: true,
                redirectTo: '/dashboard',
            });
            expect(authClient.signIn.email).toHaveBeenCalledWith({
                email: 'test@example.com',
                password: 'password123',
            });
        });

        it('returns error when login fails', async () => {
            vi.mocked(authClient.signIn.email).mockResolvedValueOnce({
                data: null,
                error: { message: 'Invalid credentials' },
            });

            const result = await tenantAuthProvider.login({
                email: 'wrong@example.com',
                password: 'wrongpassword',
            });

            expect(result).toEqual({
                success: false,
                error: {
                    name: 'LoginError',
                    message: 'Invalid credentials',
                },
            });
        });

        it('uses default error message when error message is missing', async () => {
            vi.mocked(authClient.signIn.email).mockResolvedValueOnce({
                data: null,
                error: {} as Error,
            });

            const result = await tenantAuthProvider.login({
                email: 'test@example.com',
                password: 'password',
            });

            expect(result.success).toBe(false);
            expect(result.error?.message).toBe('Invalid credentials');
        });
    });

    describe('logout', () => {
        it('signs out and redirects to login', async () => {
            vi.mocked(authClient.signOut).mockResolvedValueOnce(undefined);

            const result = await tenantAuthProvider.logout({});

            expect(result).toEqual({
                success: true,
                redirectTo: '/login',
            });
            expect(authClient.signOut).toHaveBeenCalled();
        });
    });

    describe('check', () => {
        it('returns authenticated true when session exists', async () => {
            vi.mocked(authClient.getSession).mockResolvedValueOnce({
                data: { user: { id: '1' }, session: {} },
                error: null,
            });

            const result = await tenantAuthProvider.check({});

            expect(result).toEqual({
                authenticated: true,
            });
        });

        it('returns authenticated false and redirects when no session', async () => {
            vi.mocked(authClient.getSession).mockResolvedValueOnce({
                data: null,
                error: null,
            });

            const result = await tenantAuthProvider.check({});

            expect(result).toEqual({
                authenticated: false,
                redirectTo: '/login',
            });
        });
    });

    describe('getIdentity', () => {
        it('returns user identity with roles array', async () => {
            vi.mocked(authClient.getSession).mockResolvedValueOnce({
                data: {
                    user: {
                        id: '123',
                        name: 'John Doe',
                        image: 'avatar.jpg',
                        roles: ['admin', 'member'],
                        organizationId: 'org-1',
                    },
                    session: {},
                },
                error: null,
            });

            const identity = await tenantAuthProvider.getIdentity?.({});

            expect(identity).toEqual({
                id: '123',
                name: 'John Doe',
                avatar: 'avatar.jpg',
                roles: ['admin', 'member'],
                organizationId: 'org-1',
            });
        });

        it('converts single role to array', async () => {
            vi.mocked(authClient.getSession).mockResolvedValueOnce({
                data: {
                    user: {
                        id: '123',
                        name: 'Jane Doe',
                        image: null,
                        role: 'member',
                        organizationId: 'org-2',
                    },
                    session: {},
                },
                error: null,
            });

            const identity = await tenantAuthProvider.getIdentity?.({}) as any;

            expect(identity?.roles).toEqual(['member']);
        });

        it('returns empty roles array when roles are missing', async () => {
            vi.mocked(authClient.getSession).mockResolvedValueOnce({
                data: {
                    user: {
                        id: '123',
                        name: 'No Role User',
                        organizationId: 'org-3',
                    },
                    session: {},
                },
                error: null,
            });

            const identity = await tenantAuthProvider.getIdentity?.({}) as any;

            expect(identity?.roles).toEqual([]);
        });

        it('returns null when no user in session', async () => {
            vi.mocked(authClient.getSession).mockResolvedValueOnce({
                data: null,
                error: null,
            });

            const identity = await tenantAuthProvider.getIdentity?.({});

            expect(identity).toBeNull();
        });
    });

    describe('onError', () => {
        let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
        afterEach(() => {
            consoleErrorSpy?.mockRestore();
        });
        it('console.errors the error and returns it', async () => {
            consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => { });
            const error = new Error('Test error');

            const result = await tenantAuthProvider.onError(error);

            expect(result).toEqual({ error });
            expect(consoleErrorSpy).toHaveBeenCalledWith(error);
        });
    });
});
