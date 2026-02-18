import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { AuthCallbackPage } from './AuthCallbackPage';

// Mock dependencies
const mockNavigate = vi.fn();

vi.mock('react-router-dom', async () => {
    const actual = await vi.importActual('react-router-dom');
    return {
        ...actual,
        useNavigate: () => mockNavigate,
    };
});

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

import { hasPermission } from '@/shared/lib/auth/utils';
import { AppRoutes } from '@/shared/lib/auth/constants';

describe('AuthCallbackPage', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('shows loading spinner during authentication check', () => {
        mockUseAuth.mockReturnValue({
            user: null,
            isLoading: true,
        });

        render(
            <BrowserRouter>
                <AuthCallbackPage />
            </BrowserRouter>
        );

        expect(screen.getByText('Finalizing authentication...')).toBeInTheDocument();
    });

    it('redirects admin users to admin dashboard', async () => {
        mockUseAuth.mockReturnValue({
            user: {
                id: '1',
                email: 'admin@test.com',
                permissions: ['admin:dashboard:view'],
            },
            isLoading: false,
        });

        vi.mocked(hasPermission).mockReturnValue(true);

        render(
            <BrowserRouter>
                <AuthCallbackPage />
            </BrowserRouter>
        );

        await waitFor(() => {
            expect(mockNavigate).toHaveBeenCalledWith(AppRoutes.ADMIN.ROOT, { replace: true });
        });
    });

    it('redirects non-admin users to tenant dashboard', async () => {
        mockUseAuth.mockReturnValue({
            user: {
                id: '2',
                email: 'user@test.com',
                permissions: ['tenant:read'],
            },
            isLoading: false,
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
    });

    it('redirects to login with error when authentication fails', async () => {
        mockUseAuth.mockReturnValue({
            user: null,
            isLoading: false,
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
        });

        render(
            <BrowserRouter>
                <AuthCallbackPage />
            </BrowserRouter>
        );

        expect(mockNavigate).not.toHaveBeenCalled();
    });
});
