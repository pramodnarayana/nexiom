import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { AuthCallbackPage } from './AuthCallbackPage';

// Mock dependencies
const mockNavigate = vi.fn();

vi.mock('react-router-dom', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-router-dom')>();
    return {
        ...actual,
        useNavigate: () => mockNavigate,
    };
});

const mockRefreshSession = vi.fn();
const mockUseAuth = vi.fn();
vi.mock('@/shared/hooks/useAuth', () => ({
    useAuth: () => mockUseAuth(),
}));

vi.mock('@/shared/lib/auth/utils', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/shared/lib/auth/utils')>();
    return {
        ...actual,
        hasPermission: vi.fn(),
    };
});

const mockApiPost = vi.fn();
vi.mock('@/shared/lib/api-client', () => ({
    apiClient: {
        post: (...args: unknown[]) => mockApiPost(...args),
    },
}));

import { hasPermission } from '@/shared/lib/auth/utils';
import { AppRoutes } from '@/shared/lib/auth/constants';

describe('AuthCallbackPage', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockRefreshSession.mockResolvedValue(undefined);
        mockApiPost.mockResolvedValue({});
    });

    it('shows loading spinner during authentication check', () => {
        mockUseAuth.mockReturnValue({
            user: null,
            isLoading: true,
            refreshSession: mockRefreshSession,
        });

        render(
            <BrowserRouter>
                <AuthCallbackPage />
            </BrowserRouter>
        );

        expect(screen.getByText('Finalizing authentication...')).toBeInTheDocument();
    });

    it('redirects admin users with tenant to admin dashboard', async () => {
        mockUseAuth.mockReturnValue({
            user: {
                id: '1',
                email: 'admin@test.com',
                // isSystemOwner checks for 'admin_dashboard:view' (underscore)
                permissions: ['admin_dashboard:view', 'system_users:read'],
                hasTenant: true,
            },
            isLoading: false,
            refreshSession: mockRefreshSession,
        });

        render(
            <BrowserRouter>
                <AuthCallbackPage />
            </BrowserRouter>
        );

        await waitFor(() => {
            expect(mockNavigate).toHaveBeenCalledWith(AppRoutes.ADMIN.ROOT, { replace: true });
        });
        expect(mockApiPost).not.toHaveBeenCalled();
    });

    it('redirects non-admin users with tenant to tenant dashboard', async () => {
        mockUseAuth.mockReturnValue({
            user: {
                id: '2',
                email: 'user@test.com',
                permissions: ['tenant:read'],
                hasTenant: true,
            },
            isLoading: false,
            refreshSession: mockRefreshSession,
        });

        vi.mocked(hasPermission).mockReturnValue(false);

        render(
            <BrowserRouter>
                <AuthCallbackPage />
            </BrowserRouter>
        );

        await waitFor(() => {
            expect(mockNavigate).toHaveBeenCalledWith(AppRoutes.TENANT.ROOT, { replace: true });
        });
        expect(mockApiPost).not.toHaveBeenCalled();
    });

    it('provisions tenant and redirects when user has no tenant (first Google sign-in)', async () => {
        mockUseAuth.mockReturnValue({
            user: {
                id: '3',
                email: 'newgoogle@test.com',
                permissions: ['dashboard:read'],
                hasTenant: false,
            },
            isLoading: false,
            refreshSession: mockRefreshSession,
        });

        vi.mocked(hasPermission).mockReturnValue(false);

        render(
            <BrowserRouter>
                <AuthCallbackPage />
            </BrowserRouter>
        );

        await waitFor(() => {
            expect(mockApiPost).toHaveBeenCalledWith('/auth/provision-tenant');
            expect(mockRefreshSession).toHaveBeenCalledWith();
            expect(mockNavigate).toHaveBeenCalledWith(AppRoutes.TENANT.ROOT, { replace: true });
        });
    });

    it('redirects to login with error when authentication fails', async () => {
        mockUseAuth.mockReturnValue({
            user: null,
            isLoading: false,
            refreshSession: mockRefreshSession,
        });

        render(
            <BrowserRouter>
                <AuthCallbackPage />
            </BrowserRouter>
        );

        await waitFor(() => {
            expect(mockNavigate).toHaveBeenCalledWith(
                `${AppRoutes.AUTH.LOGIN}?error=auth_failed`,
                { replace: true }
            );
        });
    });

    it('does not navigate while loading', () => {
        mockUseAuth.mockReturnValue({
            user: null,
            isLoading: true,
            refreshSession: mockRefreshSession,
        });

        render(
            <BrowserRouter>
                <AuthCallbackPage />
            </BrowserRouter>
        );

        expect(mockNavigate).not.toHaveBeenCalled();
    });
});
