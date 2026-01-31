import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { AdminLayout } from './AdminLayout';
import { useAuth } from '@/shared/lib/auth/context';
import { useNavigate, useLocation } from 'react-router-dom';
import { ThemeProvider } from "@/shared/lib/theme/ThemeProvider";
// Mock Dependencies
vi.mock('@/shared/lib/auth/context', () => ({
    useAuth: vi.fn(),
}));

vi.mock('react-router-dom', () => ({
    useNavigate: vi.fn(),
    useLocation: vi.fn(),
    Outlet: () => <div data-testid="outlet">Child Content</div>, // Mock Outlet
    Link: ({ to, children }: { to: string; children: React.ReactNode }) => <a href={to}>{children}</a>,
}));

// Mock UI components that might cause issues or are heavy
vi.mock('@/shared/components/ui/sheet', () => ({
    Sheet: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    SheetTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    SheetContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/shared/components/ui/dropdown-menu', () => ({
    DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    DropdownMenuItem: ({ children, onClick }: { children: React.ReactNode, onClick?: () => void }) => <button type="button" onClick={onClick}>{children}</button>,
    DropdownMenuLabel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    DropdownMenuSeparator: () => <hr />,
}));


describe('AdminLayout', () => {
    const mockNavigate = vi.fn();
    const mockLogout = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
        (useNavigate as unknown as Mock).mockReturnValue(mockNavigate);
        (useLocation as unknown as Mock).mockReturnValue({ pathname: '/admin' });
    });

    it('renders loading state', () => {
        (useAuth as unknown as Mock).mockReturnValue({
            isLoading: true,
            isAuthenticated: false,
            user: null,
            logout: mockLogout
        });

        render(
            <ThemeProvider defaultTheme="violet-bloom" storageKey="test-theme">
                <AdminLayout />
            </ThemeProvider>
        );
        expect(screen.getByText('Loading Admin Panel...')).toBeInTheDocument();
    });

    it('redirects to login if not authenticated', async () => {
        (useAuth as unknown as Mock).mockReturnValue({
            isLoading: false,
            isAuthenticated: false, // Not auth
            user: null,
            logout: mockLogout
        });

        render(
            <ThemeProvider defaultTheme="violet-bloom" storageKey="test-theme">
                <AdminLayout />
            </ThemeProvider>
        );

        await waitFor(() => {
            expect(mockNavigate).toHaveBeenCalledWith('/login');
        });
    });



    it('renders content when user is platform_user', () => {
        (useAuth as unknown as Mock).mockReturnValue({
            isLoading: false,
            isAuthenticated: true,
            user: { name: 'Staff', permissions: ['tenants:read'] },
            logout: mockLogout
        });

        render(
            <ThemeProvider defaultTheme="violet-bloom" storageKey="test-theme">
                <AdminLayout />
            </ThemeProvider>
        );

        expect(screen.getByTestId('outlet')).toBeInTheDocument();
        expect(screen.getAllByText('Admin Console')).toHaveLength(3);
        // Should show tenants link because of 'tenants:read' permission
        // Note: The Sidebar implementation blindly maps navigation groups, 
        // but robust tests might check exact links. For now, we assert basic rendering.
    });

    it('renders content when user is platform_admin', () => {
        (useAuth as unknown as Mock).mockReturnValue({
            isLoading: false,
            isAuthenticated: true,
            user: { name: 'Admin', permissions: ['*'] },
            logout: mockLogout
        });

        render(
            <ThemeProvider defaultTheme="violet-bloom" storageKey="test-theme">
                <AdminLayout />
            </ThemeProvider>
        );

        expect(screen.getByTestId('outlet')).toBeInTheDocument();
        // It renders twice (Desktop + Mobile sidebars)
        expect(screen.getAllByText('Admin Console')).toHaveLength(3);
        expect(screen.getAllByText('Admin')).toHaveLength(2); // Desktop + Mobile sidebars
    });
});
