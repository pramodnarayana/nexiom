import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ForgotPasswordPage } from './ForgotPasswordPage';
import { authClient } from '../../lib/auth-client';
import { MemoryRouter } from 'react-router-dom';

// Mock auth-client
vi.mock('../../lib/auth-client', () => ({
    authClient: {
        requestPasswordReset: vi.fn(),
    },
}));

describe('ForgotPasswordPage', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    const renderComponent = () =>
        render(
            <MemoryRouter>
                <ForgotPasswordPage />
            </MemoryRouter>
        );

    it('renders the form correctly', () => {
        renderComponent();
        expect(screen.getByText(/forgot password/i)).toBeInTheDocument();
        expect(screen.getByPlaceholderText(/email/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /send reset link/i })).toBeInTheDocument();
    });

    it('handles submission success', async () => {
        (authClient.requestPasswordReset as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { status: true }, error: null });

        renderComponent();

        const emailInput = screen.getByPlaceholderText(/email/i);
        const submitBtn = screen.getByRole('button', { name: /send reset link/i });

        fireEvent.change(emailInput, { target: { value: 'test@example.com' } });
        fireEvent.click(submitBtn);

        expect(screen.getByText(/sending.../i)).toBeInTheDocument();

        await waitFor(() => {
            expect(authClient.requestPasswordReset).toHaveBeenCalledWith({
                email: 'test@example.com',
                redirectTo: '/reset-password',
            });
            expect(screen.getByText(/check your email/i)).toBeInTheDocument();
        });
    });

    it('handles submission error', async () => {
        (authClient.requestPasswordReset as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Network error'));

        renderComponent();

        const emailInput = screen.getByPlaceholderText(/email/i);
        const submitBtn = screen.getByRole('button', { name: /send reset link/i });

        fireEvent.change(emailInput, { target: { value: 'fail@example.com' } });
        fireEvent.click(submitBtn);

        await waitFor(() => {
            expect(screen.getByText('Network error')).toBeInTheDocument();
        });
    });
});
