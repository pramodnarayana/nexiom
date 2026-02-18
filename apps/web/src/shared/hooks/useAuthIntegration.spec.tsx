import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useAuth } from './useAuth';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '../lib/auth/AuthProvider';
import { authClient } from '../lib/auth-client';

// Mock the auth-client to avoid network/fetch polyfill issues with better-auth in JSDOM
vi.mock('../lib/auth-client', () => ({
    authClient: {
        getSession: vi.fn(),
        signOut: vi.fn(),
    }
}));

// Real Providers, Real Hook, Mocked Auth Client, Fake Network (MSW for other requests)
const createWrapper = () => {
    const queryClient = new QueryClient({
        defaultOptions: {
            queries: {
                retry: false,
            },
        },
    });

    return ({ children }: { children: React.ReactNode }) => (
        <QueryClientProvider client={queryClient}>
            <AuthProvider>
                {children}
            </AuthProvider>
        </QueryClientProvider>
    );
};

// Test Component to consume hook
const TestComponent = () => {
    const { user, isAuthenticated, isLoading } = useAuth();

    if (isLoading) return <div>Loading...</div>;
    if (isAuthenticated) return <div>Authenticated: {user?.email}</div>;
    return <div>Not Authenticated</div>;
};

describe('useAuth Integration (Mocked Client)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });
    it('should authenticate user via mocked authClient', async () => {
        // Setup successful session mock
        vi.mocked(authClient.getSession).mockResolvedValue({
            data: {
                user: {
                    id: 'test-user-id',
                    email: 'test@example.com',
                    name: 'Test User',
                    role: 'user',
                    emailVerified: true,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
                session: {
                    token: 'test-session-token',
                    expiresAt: new Date(Date.now() + 86400000),
                    ipAddress: '127.0.0.1',
                    userAgent: 'test-agent',
                    userId: 'test-user-id',
                    id: 'session-id',
                    createdAt: new Date(),
                    updatedAt: new Date(),
                }
            },
            error: null
        });

        const Wrapper = createWrapper();

        render(
            <Wrapper>
                <TestComponent />
            </Wrapper>
        );

        // Should start loading
        expect(screen.getByText('Loading...')).toBeInTheDocument();

        // Should eventually display authenticated user
        await waitFor(() => {
            expect(screen.getByText('Authenticated: test@example.com')).toBeInTheDocument();
        });
    });
});

