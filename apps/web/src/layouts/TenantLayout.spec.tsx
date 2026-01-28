import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { TenantLayout } from './TenantLayout';
import { useAuth } from '@/lib/auth/context';
import { useNavigate, useLocation } from 'react-router-dom';
import { ThemeProvider } from "@/lib/theme/ThemeProvider";

// Mock Dependencies
vi.mock('@/lib/auth/context', () => ({
    useAuth: vi.fn(),
}));

vi.mock('react-router-dom', () => ({
    useNavigate: vi.fn(),
    useLocation: vi.fn(),
    Outlet: () => <div data-testid="outlet">Tenant Content</div>,
    Link: ({ to, children }: { to: string; children: React.ReactNode }) => <a href={to}>{children}</a>,
    useParams: () => ({ tenantId: 'org-123' }),
}));

// Mock UI components
vi.mock('@/components/ui/sheet', () => ({
    Sheet: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    SheetTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    SheetContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/ui/dropdown-menu', () => ({
    DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    DropdownMenuItem: ({ children, onClick }: { children: React.ReactNode, onClick?: () => void }) => <div onClick={onClick}>{children}</div>,
    DropdownMenuLabel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    DropdownMenuSeparator: () => <hr />,
}));

vi.mock('@/components/ui/avatar', () => ({
    Avatar: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    AvatarImage: () => <img alt="avatar" />,
    AvatarFallback: () => <span>A</span>,
}));


describe('TenantLayout', () => {
    const mockNavigate = vi.fn();
    const mockLogout = vi.fn();

    // Sample nav groups for testing
    const mockNavGroups = [
        {
            title: 'Main',
            items: [
                { label: 'Dashboard', href: '/org-123/dashboard', icon: () => <svg /> },
                { label: 'Settings', href: '/org-123/settings', icon: () => <svg /> }
            ]
        }
    ];

    beforeEach(() => {
        vi.clearAllMocks();
        (useNavigate as unknown as Mock).mockReturnValue(mockNavigate);
        (useLocation as unknown as Mock).mockReturnValue({ pathname: '/org-123/dashboard' });
    });



    const renderWithTheme = (component: React.ReactNode) => {
        return render(
            <ThemeProvider defaultTheme="violet-bloom" storageKey="test-theme">
                {component}
            </ThemeProvider>
        );
    };

    it('renders loading state', () => {
        (useAuth as unknown as Mock).mockReturnValue({
            isLoading: true,
            isAuthenticated: false,
            user: null,
            logout: mockLogout
        });

        renderWithTheme(<TenantLayout navGroups={mockNavGroups} />);
        expect(screen.getByText('Loading...')).toBeInTheDocument();
    });

    it('redirects to login if not authenticated', async () => {
        (useAuth as unknown as Mock).mockReturnValue({
            isLoading: false,
            isAuthenticated: false,
            user: null,
            logout: mockLogout
        });

        renderWithTheme(<TenantLayout navGroups={mockNavGroups} />);

        await waitFor(() => {
            expect(mockNavigate).toHaveBeenCalledWith('/login');
        });
    });

    it('renders correctly for authenticated user', async () => {
        (useAuth as unknown as Mock).mockReturnValue({
            isLoading: false,
            isAuthenticated: true,
            user: { name: 'Tenant User', email: 'user@org.com', organizationName: 'Acme Corp' },
            logout: mockLogout
        });

        renderWithTheme(<TenantLayout navGroups={mockNavGroups} />);

        expect(screen.getByTestId('outlet')).toBeInTheDocument();
        expect(screen.getAllByText('Dashboard')).toHaveLength(3); // Sidebar x2 + Breadcrumb
    });

    it('displays user profile info', () => {
        (useAuth as unknown as Mock).mockReturnValue({
            isLoading: false,
            isAuthenticated: true,
            user: { name: 'John Doe', email: 'john@example.com', organizationName: 'Acme Corp' },
            logout: mockLogout
        });

        renderWithTheme(<TenantLayout navGroups={mockNavGroups} />);

        // It renders twice (Desktop + Mobile sidebars)
        // SidebarContent: line 56 shows user.organizationName.
        // Topbar Dropdown: Line 193 shows user.name.

        expect(screen.getAllByText('John Doe').length).toBeGreaterThanOrEqual(1);
        expect(screen.getAllByText('john@example.com').length).toBeGreaterThanOrEqual(1);
        expect(screen.getAllByText('Acme Corp').length).toBeGreaterThanOrEqual(1);
    });
});
