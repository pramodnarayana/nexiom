import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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
            login: mockLogin,
            signup: mockSignup,
        });
    });

    it('renders landing page content', () => {
        render(<LandingPage />);
        expect(screen.getByRole('heading', { name: 'Nexiom' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Login' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Sign Up' })).toBeInTheDocument();
    });

    it('navigates to dashboard if authenticated', () => {
        (useAuth as unknown as Mock).mockReturnValue({
            isAuthenticated: true,
        });
        render(<LandingPage />);
        expect(mockNavigate).toHaveBeenCalledWith('/dashboard', { replace: true });
        expect(screen.getByText('Redirecting to your dashboard...')).toBeInTheDocument();
    });

    it('triggers login and signup', () => {
        render(<LandingPage />);
        fireEvent.click(screen.getByRole('button', { name: 'Login' }));
        expect(mockLogin).toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: 'Sign Up' }));
        expect(mockSignup).toHaveBeenCalled();
    });
});
