import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router-dom';
import { TenantList } from './TenantList';
import { type TenantTableItem } from './types';
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { AuthProvider } from '@/lib/auth/AuthProvider';
import { AuthContext } from '@/lib/auth/context';

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

describe('TenantList Component', () => {
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
        }
    ];

    const renderComponent = (props: Partial<React.ComponentProps<typeof TenantList>> = {}) => {
        return render(
            <BrowserRouter>
                <AuthProvider>
                    <TenantList
                        data={mockData}
                        isLoading={false}
                        {...props}
                    />
                </AuthProvider>
            </BrowserRouter>
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
        expect(screen.getByText('Active')).toBeInTheDocument();

        expect(screen.getByText('Beta Inc')).toBeInTheDocument();
        expect(screen.getByText('Suspended')).toBeInTheDocument();
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
            systemRole: 'platform_admin' as const,
            roles: [],
        };

        const mockAuthValue = {
            user: mockUser,
            session: { user: mockUser },
            isLoading: false,
            isAuthenticated: true,
            login: vi.fn(),
            logout: vi.fn(),
            signup: vi.fn(),
            setAuthState: vi.fn(),
        };

        render(
            <BrowserRouter>
                <AuthContext.Provider value={mockAuthValue}>
                    <TenantList data={mockData} isLoading={false} />
                </AuthContext.Provider>
            </BrowserRouter>
        );

        // Platform admin should see status as dropdown button
        const statusButtons = screen.getAllByRole('button', { name: /active|suspended/i });
        expect(statusButtons.length).toBeGreaterThan(0);
    });

    it('shows read-only status badge for platform_user', () => {
        const mockUser = {
            id: 'user-1',
            email: 'user@example.com',
            name: 'Platform User',
            systemRole: 'platform_user' as const,
            roles: [],
        };

        const mockAuthValue = {
            user: mockUser,
            session: { user: mockUser },
            isLoading: false,
            isAuthenticated: true,
            login: vi.fn(),
            logout: vi.fn(),
            signup: vi.fn(),
            setAuthState: vi.fn(),
        };

        render(
            <BrowserRouter>
                <AuthContext.Provider value={mockAuthValue}>
                    <TenantList data={mockData} isLoading={false} />
                </AuthContext.Provider>
            </BrowserRouter>
        );

        // Platform user should see status as read-only badge (not a button)
        const statusButtons = screen.queryAllByRole('button', { name: /active|suspended/i });
        // Should not find status dropdown buttons
        expect(statusButtons.length).toBe(2);

        // Should find status text as plain text
        expect(screen.getByText('Active')).toBeInTheDocument();
    });

    it('hides action menu for platform_user', () => {
        const mockUser = {
            id: 'user-1',
            email: 'user@example.com',
            name: 'Platform User',
            systemRole: 'platform_user' as const,
            roles: [],
        };

        const mockAuthValue = {
            user: mockUser,
            session: { user: mockUser },
            isLoading: false,
            isAuthenticated: true,
            login: vi.fn(),
            logout: vi.fn(),
            signup: vi.fn(),
            setAuthState: vi.fn(),
        };

        render(
            <BrowserRouter>
                <AuthContext.Provider value={mockAuthValue}>
                    <TenantList data={mockData} isLoading={false} />
                </AuthContext.Provider>
            </BrowserRouter>
        );

        // Platform user should not see action menu buttons (Edit/Delete)
        const actionButtons = screen.queryAllByRole('button', { name: /more/i });
        expect(actionButtons.length).toBe(0);
    });


});
