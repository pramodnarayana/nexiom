import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { LandingPage } from './LandingPage';
import { useAuth } from '@/shared/hooks/useAuth';
import { useNavigate } from 'react-router-dom';

// Mock Dependencies
vi.mock('@/shared/hooks/useAuth', () => ({
    useAuth: vi.fn(),
}));

vi.mock('react-router-dom', () => ({
    useNavigate: vi.fn(),
}));

describe('LandingPage', () => {
    const mockNavigate = vi.fn();
    const mockLogin = vi.fn();
    const mockSignup = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        (useNavigate as unknown as Mock).mockReturnValue(mockNavigate);
        (useAuth as unknown as Mock).mockReturnValue({
            isAuthenticated: false,
            isLoading: false,
            login: mockLogin,
            signup: mockSignup,
        });
    });

    it('renders landing page content', async () => {
        render(<LandingPage />);
        await waitFor(() => {
            expect(screen.getByRole('heading', { name: 'Soopa' })).toBeInTheDocument();
        });
        expect(screen.getByRole('button', { name: 'Login' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Sign Up' })).toBeInTheDocument();
    });

    it('navigates to dashboard if authenticated', async () => {
        (useAuth as unknown as Mock).mockReturnValue({
            isAuthenticated: true,
            isLoading: false,
        });
        render(<LandingPage />);
        expect(mockNavigate).toHaveBeenCalledWith('/dashboard', { replace: true });
    });

    it('navigates to auth pages on button click', async () => {
        render(<LandingPage />);
        await waitFor(() => {
            expect(screen.getByRole('button', { name: 'Login' })).toBeInTheDocument();
        });

        fireEvent.click(screen.getByRole('button', { name: 'Login' }));
        expect(mockNavigate).toHaveBeenCalledWith('/login');

        fireEvent.click(screen.getByRole('button', { name: 'Sign Up' }));
        expect(mockNavigate).toHaveBeenCalledWith('/signup');
    });
});
