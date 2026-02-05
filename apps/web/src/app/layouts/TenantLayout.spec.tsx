import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { TenantLayout } from './TenantLayout';
import { AuthContext } from '@/shared/lib/auth/context';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Mock useOrganization hook
vi.mock('@/modules/identity/hooks/useOrganization', () => ({
    useOrganization: vi.fn(() => ({
        data: { id: 'org-1', name: 'Test Org' },
        isLoading: false,
        error: null,
    })),
}));

// Mock Sidebar and other components
// Mock both cases to be safe with Vitest resolution
vi.mock('@/shared/components/layout/Sidebar', () => ({
    Sidebar: () => <div data-testid="app-sidebar">Sidebar</div>,
}));
vi.mock('@/shared/components/layout/sidebar', () => ({
    Sidebar: () => <div data-testid="app-sidebar">Sidebar</div>,
}));

vi.mock('@/shared/components/layout/Navbar', () => ({
    Navbar: () => <div data-testid="navbar">Navbar</div>,
}));

describe('TenantLayout', () => {
    const createQueryClient = () => new QueryClient({
        defaultOptions: {
            queries: {
                retry: false,
            },
        },
    });

    const mockUser = {
        id: 'u1',
        email: 'test@example.com',
        name: 'Test User',
        roles: [],
        organizationId: 'org-1'
    };

    const mockAuthContext = {
        user: mockUser,
        isAuthenticated: true,
        isLoading: false,
        login: vi.fn(),
        signup: vi.fn(),
        logout: vi.fn(),
        setAuthState: vi.fn(),
        refreshSession: vi.fn().mockResolvedValue(undefined),
        token: 'mock-token',
    };

    const renderComponent = (authOverrides = {}) => {
        const client = createQueryClient();
        return render(
            <QueryClientProvider client={client}>
                <AuthContext.Provider value={{ ...mockAuthContext, ...authOverrides }}>
                    <MemoryRouter initialEntries={['/dashboard']}>
                        <Routes>
                            <Route path="/dashboard" element={<TenantLayout navGroups={[]} />}>
                                <Route path="" element={<div>Child Content</div>} />
                            </Route>
                            <Route path="/login" element={<div>Login Page</div>} />
                        </Routes>
                    </MemoryRouter>
                </AuthContext.Provider>
            </QueryClientProvider>
        );
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders loading state', () => {
        renderComponent({ isLoading: true });
        // Fix: Match text 'Loading...'
        expect(screen.getByText('Loading...')).toBeInTheDocument();
    });

    it('redirects to login if not authenticated', async () => {
        renderComponent({ isAuthenticated: false, user: null });
        await waitFor(() => {
            expect(screen.getByText('Login Page')).toBeInTheDocument();
        });
    });

    it('renders correctly for authenticated user', () => {
        renderComponent();
        expect(screen.getByTestId('app-sidebar')).toBeInTheDocument();
        expect(screen.getByText('Child Content')).toBeInTheDocument();
    });

    it('displays navbar', () => {
        renderComponent();
        expect(screen.getByTestId('navbar')).toBeInTheDocument();
    });
});
