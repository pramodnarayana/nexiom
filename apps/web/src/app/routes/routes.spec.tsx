import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { AppRouter } from './AppRouter';

// --- Mocks ---

// Mock Refine Core to just render children
vi.mock('@refinedev/core', async () => {
    const actual = await vi.importActual('@refinedev/core');
    return {
        ...actual,
        Refine: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
        Authenticated: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    };
});

// Mock Providers that might be used in Routes
vi.mock('../providers/data-provider', () => ({ dataProvider: {} }));
vi.mock('../providers/auth-provider', () => ({ authProvider: {} }));
vi.mock('../providers/tenant-auth-provider', () => ({ tenantAuthProvider: {} }));
vi.mock('../providers/access-control-provider', () => ({ accessControlProvider: {} }));
vi.mock('../providers/notification-provider', () => ({ notificationProvider: {} }));
vi.mock('@refinedev/react-router', () => ({ default: {} }));

// Mock Leaf Components (Pages) to verify routing targets
vi.mock('../../modules/identity/pages/LoginPage', () => ({ LoginPage: () => <div>Mocked LoginPage</div> }));
vi.mock('../../modules/identity/pages/SignupPage', () => ({ SignupPage: () => <div>Mocked SignupPage</div> }));
vi.mock('../../modules/identity/pages/AcceptInvitePage', () => ({ AcceptInvitePage: () => <div>Mocked AcceptInvitePage</div> }));
vi.mock('../../modules/dashboard/pages/DashboardPage', () => ({ DashboardPage: () => <div>Mocked Tenant DashboardPage</div> }));
vi.mock('../../modules/dashboard/pages/admin/AdminDashboardPage', () => ({ AdminDashboardPage: () => <div>Mocked AdminDashboardPage</div> }));
vi.mock('../../modules/identity/users/UserList', () => ({ UserList: () => <div>Mocked UserList</div> }));
vi.mock('../../modules/tenants/pages/TenantListPage', () => ({ TenantListPage: () => <div>Mocked TenantListPage</div> }));

// Mock Layouts to avoid heavy rendering
vi.mock('../layouts/AdminLayout', () => ({ AdminLayout: () => <div>Mocked AdminLayout <div id="outlet-placeholder" /></div> }));
// TenantLayout might render an Outlet, so we need to mock it in a way that renders children or Outlet
// Actually simplest is to mock it to render Outlet if it uses one, but strictly mocking route components:
// In TenantRoutes, TenantLayout is a Layout Route.
// In TenantRoutes, TenantLayout is a Layout Route.
vi.mock('../layouts/TenantLayout', async () => {
    const { Outlet } = await import('react-router-dom');
    return { TenantLayout: () => <div>Mocked TenantLayout <Outlet /></div> };
});
vi.mock('../layouts/AdminLayout', async () => {
    const { Outlet } = await import('react-router-dom');
    return { AdminLayout: () => <div>Mocked AdminLayout <Outlet /></div> };
});

describe('App Routing Smoke Tests', () => {
    const renderWithRouter = (initialEntry: string) => {
        return render(
            <MemoryRouter initialEntries={[initialEntry]}>
                <AppRouter />
            </MemoryRouter>
        );
    };

    describe('Auth Routes', () => {
        it('renders LoginPage at /login', () => {
            renderWithRouter('/login');
            expect(screen.getByText('Mocked LoginPage')).toBeInTheDocument();
        });

        it('renders SignupPage at /signup', () => {
            renderWithRouter('/signup');
            expect(screen.getByText('Mocked SignupPage')).toBeInTheDocument();
        });
    });

    describe('Admin Routes', () => {
        it('renders AdminDashboardPage at /admin', () => {
            renderWithRouter('/admin');
            expect(screen.getByText('Mocked AdminDashboardPage')).toBeInTheDocument();
        });

        it('renders UserList at /admin/users', () => {
            renderWithRouter('/admin/users');
            expect(screen.getByText('Mocked UserList')).toBeInTheDocument();
        });

        it('renders TenantListPage at /admin/tenants', () => {
            renderWithRouter('/admin/tenants');
            expect(screen.getByText('Mocked TenantListPage')).toBeInTheDocument();
        });
    });

    describe('Tenant Routes', () => {
        it('renders DashboardPage at /dashboard', () => {
            renderWithRouter('/dashboard');
            expect(screen.getByText('Mocked Tenant DashboardPage')).toBeInTheDocument();
        });

        it('renders UserList at /dashboard/users', () => {
            renderWithRouter('/dashboard/users');
            expect(screen.getByText('Mocked UserList')).toBeInTheDocument();
        });
    });
});
