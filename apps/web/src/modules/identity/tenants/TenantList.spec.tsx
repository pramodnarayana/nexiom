import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router-dom';
import { TenantList } from './TenantList';
import { type TenantTableItem } from './types';
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { AuthProvider } from '@/shared/lib/auth/AuthProvider';
import { AuthContext } from '@/shared/lib/auth/context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useCan } from "@refinedev/core"; // Import mocked useCan

// Mock ResizeObserver and scrollIntoView for Radix UI
beforeAll(() => {
    globalThis.ResizeObserver = vi.fn().mockImplementation(() => ({
        observe: vi.fn(),
        unobserve: vi.fn(),
        disconnect: vi.fn(),
    }));
    globalThis.HTMLElement.prototype.scrollIntoView = vi.fn();
    globalThis.HTMLElement.prototype.hasPointerCapture = vi.fn();
    globalThis.HTMLElement.prototype.releasePointerCapture = vi.fn();
});

// Mock useCan from refinedev/core
vi.mock("@refinedev/core", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@refinedev/core")>();
    return {
        ...actual,
        useCan: vi.fn(), // Default empty mock, we configure it per test
        useDelete: () => ({ mutate: vi.fn() }),
    };
});


describe('TenantList Component', () => {
    // Helper to create a fresh client
    const createQueryClient = () => new QueryClient({
        defaultOptions: {
            queries: {
                retry: false,
            },
        },
    });

    // Reset mocks before each test
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(useCan).mockReturnValue({ data: { can: true } } as any); // Default allow
    });

    const mockData: TenantTableItem[] = [
        {
            id: '1',
            name: 'Acme Corp',
            slug: 'acme',
            logo: null,
            status: 'active',
            createdAt: new Date('2023-01-01'),
            metadata: null,
            updatedAt: new Date(),
            isSystem: false,
        },
        {
            id: '2',
            name: 'Beta Inc',
            slug: 'beta',
            logo: null,
            status: 'suspended',
            createdAt: new Date('2023-02-01'),
            metadata: null,
            updatedAt: new Date(),
            isSystem: false,
        }
    ];

    const renderComponent = (props: Partial<React.ComponentProps<typeof TenantList>> = {}) => {
        const client = createQueryClient();
        return render(
            <QueryClientProvider client={client}>
                <BrowserRouter>
                    <AuthProvider>
                        <TenantList
                            data={mockData}
                            isLoading={false}
                            {...props}
                        />
                    </AuthProvider>
                </BrowserRouter>
            </QueryClientProvider>
        );
    };

    it('renders loading state', () => {
        renderComponent({ isLoading: true });
        expect(screen.getByText('Loading tenants...')).toBeInTheDocument();
    });

    it('renders empty state', () => {
        renderComponent({ data: [] });
        expect(screen.getByText('No tenants found.')).toBeInTheDocument();
    });

    it('renders tenant data correctly', () => {
        renderComponent();
        expect(screen.getByText('Acme Corp')).toBeInTheDocument();
        expect(screen.getByText('acme')).toBeInTheDocument();
        expect(screen.getByText('Active')).toBeInTheDocument(); // Permissions allow by default
    });

    it('filters data by search term', async () => {
        const user = userEvent.setup();
        renderComponent();
        const searchInput = screen.getByPlaceholderText('Search tenants...');

        await user.type(searchInput, 'beta');

        expect(screen.queryByText('Acme Corp')).not.toBeInTheDocument();
        expect(screen.getByText('Beta Inc')).toBeInTheDocument();
    });

    it('shows status dropdown for platform_admin', () => {
        const mockUser = {
            id: 'admin-1',
            email: 'admin@example.com',
            name: 'Admin User',
            roles: [],
            permissions: ['tenants:manage'], // Added permission
        };

        const mockAuthValue = {
            user: mockUser,
            token: 'mock-token',
            session: { user: mockUser },
            isLoading: false,
            isAuthenticated: true,
            login: vi.fn(),
            logout: vi.fn(),
            signup: vi.fn(),
            setAuthState: vi.fn(),
            refreshSession: vi.fn().mockResolvedValue(undefined),
        };

        const client = createQueryClient();
        render(
            <QueryClientProvider client={client}>
                <BrowserRouter>
                    <AuthContext.Provider value={mockAuthValue}>
                        <TenantList data={mockData} isLoading={false} />
                    </AuthContext.Provider>
                </BrowserRouter>
            </QueryClientProvider>
        );

        // Platform admin should see status as dropdown button
        const activeStatus = screen.getByText('Active');
        expect(activeStatus.closest('[role="button"]')).not.toBeNull();
    });

    it.skip('shows read-only status badge for platform_user', () => {
        vi.mocked(useCan).mockImplementation(() => ({ data: { can: false } } as any));

        const mockUser = {
            id: 'user-1',
            email: 'user@example.com',
            name: 'Platform User',
            roles: [],
            permissions: [], // No manage permissions
        };

        const mockAuthValue = {
            user: mockUser,
            token: 'mock-token',
            session: { user: mockUser },
            isLoading: false,
            isAuthenticated: true,
            login: vi.fn(),
            logout: vi.fn(),
            signup: vi.fn(),
            setAuthState: vi.fn(),
            refreshSession: vi.fn().mockResolvedValue(undefined),
        };

        const client = createQueryClient();
        render(
            <QueryClientProvider client={client}>
                <BrowserRouter>
                    <AuthContext.Provider value={mockAuthValue}>
                        <TenantList data={mockData} isLoading={false} />
                    </AuthContext.Provider>
                </BrowserRouter>
            </QueryClientProvider>
        );

        // Platform user should see status as read-only badge (not a button)
        const statusButtons = screen.queryAllByRole('button', { name: /active|suspended/i });
        // Should find NONE because 'can' is false
        expect(statusButtons.length).toBe(0);

        // But the TEXT should be there
        expect(screen.getByText('Active')).toBeInTheDocument();
    });
});
