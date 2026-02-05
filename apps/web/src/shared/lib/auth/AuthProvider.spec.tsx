
import { render, screen, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { AuthProvider } from './AuthProvider';
import { AuthContext } from './context';
import { authClient } from '../auth-client';
import { apiClient } from '../api-client';
import { useContext } from 'react';

// Mock dependencies
vi.mock('../auth-client', () => ({
    authClient: {
        getSession: vi.fn(),
        signIn: { email: vi.fn() },
        signOut: vi.fn(),
    },
}));

vi.mock('../api-client', () => ({
    apiClient: {
        get: vi.fn(),
        post: vi.fn(),
    },
}));

// Test Consumer Component
const TestConsumer = () => {
    const context = useContext(AuthContext);
    if (!context) throw new Error("AuthContext missing");
    const { isAuthenticated, isLoading, user, logout } = context;
    if (isLoading) return <div>Loading...</div>;
    return (
        <div>
            <div data-testid="auth-status">{isAuthenticated ? 'Authenticated' : 'Unauthenticated'}</div>
            {user && (
                <>
                    <div data-testid="user-name">{user.name}</div>
                    <div data-testid="org-name">{user.organizationName || 'No Org'}</div>
                </>
            )}
            <button onClick={() => logout()}>Logout</button>
        </div>
    );
};

describe('AuthProvider', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Default optimistic success for API calls usually, specific tests will override
    });

    it('should start in loading state', () => {
        // Mock a never-resolving promise to hold loading state
        (authClient.getSession as Mock).mockReturnValue(new Promise(() => { }));
        render(
            <AuthProvider>
                <TestConsumer />
            </AuthProvider>
        );
        expect(screen.getByText('Loading...')).toBeInTheDocument();
    });

    it('should transition to unauthenticated if session is null', async () => {
        (authClient.getSession as Mock).mockResolvedValue({ data: null, error: null });

        render(
            <AuthProvider>
                <TestConsumer />
            </AuthProvider>
        );

        await waitFor(() => {
            expect(screen.getByTestId('auth-status')).toHaveTextContent('Unauthenticated');
        });
    });

    it('should hydrate user directly if organizationId is present in session', async () => {
        (authClient.getSession as Mock).mockResolvedValue({
            data: {
                user: {
                    id: 'u1',
                    email: 'test@example.com',
                    name: 'Test User',
                    organizationId: 'org1',
                    organizationName: 'Test Org',
                    roles: ['admin']
                },
                session: { token: 't1' }
            },
            error: null
        });

        render(
            <AuthProvider>
                <TestConsumer />
            </AuthProvider>
        );

        await waitFor(() => {
            expect(screen.getByTestId('auth-status')).toHaveTextContent('Authenticated');
        });
        expect(screen.getByTestId('user-name')).toHaveTextContent('Test User');
        expect(screen.getByTestId('org-name')).toHaveTextContent('Test Org');
        // Should NOT fetch tenants
        expect(apiClient.get).not.toHaveBeenCalled();
    });

    it('should fetch tenants and hydrate if organizationId is missing', async () => {
        // Session verify OK but no org context
        (authClient.getSession as Mock).mockResolvedValue({
            data: {
                user: {
                    id: 'u1',
                    email: 'test@example.com',
                    name: 'Test User',
                    // No orgId
                },
                session: { token: 't1' }
            },
            error: null
        });

        // Mock tenant fetch
        (apiClient.get as Mock).mockResolvedValue({
            data: [
                { id: 'orgA', name: 'Org A', createdAt: '2023-01-01' },
                { id: 'orgB', name: 'Latest Org', createdAt: '2024-01-01' } // Should pick this one
            ]
        });

        render(
            <AuthProvider>
                <TestConsumer />
            </AuthProvider>
        );

        await waitFor(() => {
            expect(screen.getByTestId('auth-status')).toHaveTextContent('Authenticated');
        });

        expect(apiClient.get).toHaveBeenCalledWith('/tenants');
        // Should have picked Latest Org based on sort
        expect(screen.getByTestId('org-name')).toHaveTextContent('Latest Org');
    });

    it('should fallback to auto-provisioning if no tenants found', async () => {
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => { });
        // 1. Initial Session: No Org
        (authClient.getSession as Mock)
            .mockResolvedValueOnce({
                data: {
                    user: { id: 'u1', email: 'test@example.com' },
                    session: { token: 't1' }
                },
                error: null
            })
            // 2. Second Session Check (after provision)
            .mockResolvedValueOnce({
                data: {
                    user: { id: 'u1', email: 'test@example.com' },
                    session: { token: 't1' }
                },
                error: null
            });


        // 1. Tenant Fetch: Empty
        (apiClient.get as Mock)
            .mockResolvedValueOnce({ data: [] })
            // 2. Tenant Fetch (after provision): Success
            .mockResolvedValueOnce({
                data: [{ id: 'newOrg', name: 'New Org', createdAt: '2024-01-01' }]
            });

        // Mock Provision Call
        (apiClient.post as Mock).mockResolvedValue({});

        render(
            <AuthProvider>
                <TestConsumer />
            </AuthProvider>
        );

        await waitFor(() => {
            expect(apiClient.post).toHaveBeenCalledWith('/auth/provision-tenant');
        });

        await waitFor(() => {
            expect(screen.getByTestId('org-name')).toHaveTextContent('New Org');
        });
        consoleSpy.mockRestore();
    });

    it('should handle logout correctly', async () => {
        const originalLocation = globalThis.location;

        try {
            // Start authenticated
            (authClient.getSession as Mock).mockResolvedValue({
                data: {
                    user: { id: 'u1', name: 'User' },
                    session: { token: 't1' }
                },
                error: null
            });

            render(
                <AuthProvider>
                    <TestConsumer />
                </AuthProvider>
            );

            await waitFor(() => {
                expect(screen.getByTestId('auth-status')).toHaveTextContent('Authenticated');
            });

            // Prevent window.location assign crash
            Object.defineProperty(globalThis, 'location', {
                configurable: true,
                value: { href: '' },
            });

            const logoutBtn = screen.getByText('Logout');
            await act(async () => {
                logoutBtn.click();
            });

            expect(authClient.signOut).toHaveBeenCalled();
        } finally {
            // Always restore location
            Object.defineProperty(globalThis, 'location', {
                configurable: true,
                value: originalLocation,
            });
        }
    });
});
