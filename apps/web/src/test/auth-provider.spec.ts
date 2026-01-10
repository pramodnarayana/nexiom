import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { authProvider } from '../providers/auth-provider';
import { authClient } from '../lib/auth-client';

// Mock the Better Auth Client
vi.mock('../lib/auth-client', () => ({
    authClient: {
        signIn: {
            email: vi.fn(),
        },
        signOut: vi.fn(),
        getSession: vi.fn(),
    },
}));

describe('authProvider', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('login', () => {
        it('should return success when login is successful', async () => {
            // Mock success response
            (authClient.signIn.email as unknown as Mock).mockResolvedValue({
                data: { user: { id: '123', email: 'test@example.com' } },
                error: null,
            });

            const result = await authProvider.login({ email: 'test@example.com', password: 'password' });

            expect(authClient.signIn.email).toHaveBeenCalledWith({
                email: 'test@example.com',
                password: 'password',
            });
            expect(result).toEqual({ success: true, redirectTo: '/admin' });
        });

        it('should return error when login fails', async () => {
            // Mock error response
            (authClient.signIn.email as unknown as Mock).mockResolvedValue({
                data: null,
                error: { message: 'Invalid credentials' },
            });

            const result = await authProvider.login({ email: 'fail@example.com', password: 'wrong' });

            expect(result).toEqual({
                success: false,
                error: {
                    message: 'Invalid credentials',
                    name: 'LoginError',
                },
            });
        });
    });

    describe('logout', () => {
        it('should call signOut and return success', async () => {
            (authClient.signOut as unknown as Mock).mockResolvedValue({ data: true, error: null });

            const result = await authProvider.logout({});

            expect(authClient.signOut).toHaveBeenCalled();
            expect(result).toEqual({ success: true, redirectTo: '/login' });
        });
    });

    describe('check', () => {
        it('should return authenticated when session exists', async () => {
            (authClient.getSession as unknown as Mock).mockResolvedValue({
                data: { user: { id: '123', role: 'admin' } },
                error: null,
            });

            const result = await authProvider.check({});
            expect(result).toEqual({ authenticated: true });
        });

        it('should return unauthenticated when session is null', async () => {
            (authClient.getSession as unknown as Mock).mockResolvedValue({
                data: null,
                error: null,
            });

            const result = await authProvider.check({});
            expect(result).toEqual({
                authenticated: false,
                redirectTo: '/login',
            });
        });

        it('should return access denied error when user is not admin', async () => {
            (authClient.getSession as unknown as Mock).mockResolvedValue({
                data: { user: { id: '123', role: 'user' } },
                error: null,
            });

            const result = await authProvider.check({});
            expect(result).toEqual({
                authenticated: false,
                redirectTo: '/dashboard',
                error: {
                    message: "Access Denied",
                    name: "Unauthorized"
                }
            });
        });
    });

    describe('getIdentity', () => {
        it('should return user identity when session exists', async () => {
            (authClient.getSession as unknown as Mock).mockResolvedValue({
                data: {
                    user: {
                        id: '123',
                        name: 'Test User',
                        image: 'avatar.png',
                        roles: ['admin']
                    }
                },
                error: null,
            });

            const result = await authProvider.getIdentity!();

            expect(result).toEqual({
                id: '123',
                name: 'Test User',
                avatar: 'avatar.png',
                roles: ['admin'],
            });
        });

        it('should return null when session is missing', async () => {
            (authClient.getSession as unknown as Mock).mockResolvedValue({
                data: null,
                error: null,
            });

            const result = await authProvider.getIdentity!();
            expect(result).toBeNull();
        });
    });
});
