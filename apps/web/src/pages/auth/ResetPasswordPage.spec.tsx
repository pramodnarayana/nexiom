import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ResetPasswordPage } from './ResetPasswordPage';
import { authClient } from '../../lib/auth-client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

// Mock auth-client
vi.mock('../../lib/auth-client', () => ({
    authClient: {
        resetPassword: vi.fn(),
    },
}));

// Mock navigation
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
    const actual = await vi.importActual('react-router-dom');
    return {
        ...actual,
        useNavigate: () => mockNavigate,
    };
});

describe('ResetPasswordPage', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    const renderComponent = (token: string | null = 'valid-token') => {
        const initialEntry = token ? `/reset-password?token=${token}` : '/reset-password';
        return render(
            <MemoryRouter initialEntries={[initialEntry]}>
                <Routes>
                    <Route path="/reset-password" element={<ResetPasswordPage />} />
                </Routes>
            </MemoryRouter>
        );
    };

    it('shows error if token is missing', () => {
        renderComponent(null);
        expect(screen.getByText(/invalid link/i)).toBeInTheDocument();
        expect(screen.queryByPlaceholderText(/new password/i)).not.toBeInTheDocument();
    });

    it('renders form if token is present', () => {
        renderComponent();
        // Check for unique description text to confirm header presence
        expect(screen.getByText(/enter your new password/i)).toBeInTheDocument();
        // Check for the button specifically
        expect(screen.getByRole('button', { name: /reset password/i })).toBeInTheDocument();
        expect(screen.getByPlaceholderText('New Password')).toBeInTheDocument();
        expect(screen.getByPlaceholderText('Confirm Password')).toBeInTheDocument();
    });

    it('validates password mismatch', async () => {
        renderComponent();

        fireEvent.change(screen.getByPlaceholderText('New Password'), { target: { value: 'password123' } });
        fireEvent.change(screen.getByPlaceholderText('Confirm Password'), { target: { value: 'mismatch' } });

        fireEvent.click(screen.getByRole('button', { name: /reset password/i }));

        expect(await screen.findByText(/passwords do not match/i)).toBeInTheDocument();
        expect(authClient.resetPassword).not.toHaveBeenCalled();
    });

    it('submits successfully', async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (authClient.resetPassword as any).mockResolvedValue({ data: { status: true }, error: null });

        renderComponent();

        fireEvent.change(screen.getByPlaceholderText('New Password'), { target: { value: 'password123' } });
        fireEvent.change(screen.getByPlaceholderText('Confirm Password'), { target: { value: 'password123' } });

        fireEvent.click(screen.getByRole('button', { name: /reset password/i }));

        expect(screen.getByText(/resetting.../i)).toBeInTheDocument();

        await waitFor(() => {
            expect(authClient.resetPassword).toHaveBeenCalledWith({
                newPassword: 'password123',
                token: 'valid-token'
            });
            expect(screen.getByText(/password has been reset/i)).toBeInTheDocument();
        });

        // Test navigation
        fireEvent.click(screen.getByRole('button', { name: /go to login/i }));
        expect(mockNavigate).toHaveBeenCalledWith('/login');
    });
});
