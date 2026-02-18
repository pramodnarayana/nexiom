import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { EmailVerificationCallbackPage } from './EmailVerificationCallbackPage';

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

describe('EmailVerificationCallbackPage', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('shows loading state during verification', () => {
        mockUseAuth.mockReturnValue({
            isAuthenticated: false,
            isLoading: true,
        });

        render(
            <BrowserRouter>
                <EmailVerificationCallbackPage />
            </BrowserRouter>
        );

        expect(screen.getByText('Verifying your email...')).toBeInTheDocument();
    });

    it('redirects to tenant dashboard on successful verification', () => {
        mockUseAuth.mockReturnValue({
            isAuthenticated: true,
            isLoading: false,
        });

        render(
            <BrowserRouter>
                <EmailVerificationCallbackPage />
            </BrowserRouter>
        );

        // Navigation happens immediately when authenticated
        expect(mockNavigate).toHaveBeenCalledWith('/dashboard', { replace: true });
    });

    it('redirects to login with error after timeout when not authenticated', () => {
        mockUseAuth.mockReturnValue({
            isAuthenticated: false,
            isLoading: false,
        });

        render(
            <BrowserRouter>
                <EmailVerificationCallbackPage />
            </BrowserRouter>
        );

        // Timer hasn't fired yet
        expect(mockNavigate).not.toHaveBeenCalled();

        // Fast-forward timer by 1000ms
        act(() => {
            vi.advanceTimersByTime(1000);
        });

        expect(mockNavigate).toHaveBeenCalledWith(
            expect.stringContaining('/login?'),
            { replace: true }
        );
        expect(mockNavigate).toHaveBeenCalledWith(
            expect.stringContaining('error=Verification+failed+or+session+expired'),
            { replace: true }
        );
    });

    it('clears timeout on unmount if verification is pending', () => {
        mockUseAuth.mockReturnValue({
            isAuthenticated: false,
            isLoading: false,
        });

        const { unmount } = render(
            <BrowserRouter>
                <EmailVerificationCallbackPage />
            </BrowserRouter>
        );

        // Unmount before timer completes
        unmount();

        // Fast-forward timers
        act(() => {
            vi.advanceTimersByTime(1500);
        });

        // Navigation should not have been called after unmount
        expect(mockNavigate).not.toHaveBeenCalled();
    });

    it('does not navigate while auth is loading', () => {
        mockUseAuth.mockReturnValue({
            isAuthenticated: false,
            isLoading: true,
        });

        render(
            <BrowserRouter>
                <EmailVerificationCallbackPage />
            </BrowserRouter>
        );

        expect(mockNavigate).not.toHaveBeenCalled();
    });
});
