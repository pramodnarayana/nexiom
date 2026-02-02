import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { VerifyEmailPage } from './VerifyEmailPage';

// Mock useNavigate and useSearchParams
const mockNavigate = vi.fn();
const mockSearchParams = new URLSearchParams();

vi.mock('react-router-dom', async () => {
    const actual = await vi.importActual('react-router-dom');
    return {
        ...actual,
        useNavigate: () => mockNavigate,
        useSearchParams: () => [mockSearchParams],
    };
});

// Mock fetch
globalThis.fetch = vi.fn();

describe('VerifyEmailPage', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockSearchParams.set('email', 'test@example.com');
    });

    it('renders with email from URL params', () => {
        render(
            <BrowserRouter>
                <VerifyEmailPage />
            </BrowserRouter>
        );

        expect(screen.getByText('Check your email')).toBeInTheDocument();
        expect(screen.getByText('test@example.com')).toBeInTheDocument();
    });

    it('redirects to signup if no email provided', () => {
        mockSearchParams.delete('email');

        render(
            <BrowserRouter>
                <VerifyEmailPage />
            </BrowserRouter>
        );

        expect(mockNavigate).toHaveBeenCalledWith('/signup');
    });

    it('resend button triggers API call', async () => {
        (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
            ok: true,
            json: async () => ({ message: 'Verification email sent successfully' }),
        });

        render(
            <BrowserRouter>
                <VerifyEmailPage />
            </BrowserRouter>
        );

        const resendButton = screen.getByRole('button', { name: /resend email/i });
        fireEvent.click(resendButton);

        await waitFor(() => {
            expect(globalThis.fetch).toHaveBeenCalledWith(
                expect.stringContaining('/auth/resend-verification'),
                expect.objectContaining({
                    method: 'POST',
                    body: JSON.stringify({ email: 'test@example.com' }),
                })
            );
        });

        expect(screen.getByText(/verification email sent successfully/i)).toBeInTheDocument();
    });

    it('shows cooldown timer after resend', async () => {
        (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
            ok: true,
            json: async () => ({ message: 'Success' }),
        });

        render(
            <BrowserRouter>
                <VerifyEmailPage />
            </BrowserRouter>
        );

        const resendButton = screen.getByRole('button', { name: /resend email/i });
        fireEvent.click(resendButton);

        await waitFor(() => {
            expect(screen.getByText(/resend in \d+s/i)).toBeInTheDocument();
        });
    });

    it('handles resend error', async () => {
        (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
            ok: false,
            json: async () => ({ message: 'Failed to send email' }),
        });

        render(
            <BrowserRouter>
                <VerifyEmailPage />
            </BrowserRouter>
        );

        const resendButton = screen.getByRole('button', { name: /resend email/i });
        fireEvent.click(resendButton);

        await waitFor(() => {
            expect(screen.getByText(/Failed to resend email/i)).toBeInTheDocument();
        });
    });

    it('change email button navigates to signup', () => {
        render(
            <BrowserRouter>
                <VerifyEmailPage />
            </BrowserRouter>
        );

        const changeEmailButton = screen.getByText(/change email address/i);
        fireEvent.click(changeEmailButton);

        expect(mockNavigate).toHaveBeenCalledWith('/signup');
    });
});
