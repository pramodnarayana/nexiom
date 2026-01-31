import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { LoginPage } from './LoginPage';
import { useAuth } from '@/shared/hooks/useAuth';
import { useNavigate } from 'react-router-dom';
import { authClient } from '@/shared/lib/auth-client';

// Mock Dependencies
vi.mock('@/shared/hooks/useAuth', () => ({
    useAuth: vi.fn(),
}));

vi.mock('react-router-dom', () => ({
    useNavigate: vi.fn(),
    Link: ({ children, to, className }: { children: React.ReactNode; to: string; className?: string }) => (
        <a href={to} className={className}>
            {children}
        </a>
    ),
}));

vi.mock('@/shared/lib/auth-client', () => ({
    authClient: {
        signIn: {
            social: vi.fn(),
        },
    },
}));

// Setup global fetch mock
globalThis.fetch = vi.fn();

describe('LoginPage', () => {
    const mockNavigate = vi.fn();
    const mockSetAuthState = vi.fn();
    let originalLocation: Location;

    beforeEach(() => {
        vi.clearAllMocks();

        // Stub VITE_API_URL
        vi.stubEnv('VITE_API_URL', 'http://test-api.com');

        (useNavigate as unknown as Mock).mockReturnValue(mockNavigate);
        (useAuth as unknown as Mock).mockReturnValue({
            user: null,
            isLoading: false,
            setAuthState: mockSetAuthState,
        });
        // Default fetch mock to success
        (globalThis.fetch as Mock).mockResolvedValue({
            ok: true,
            json: async () => ({
                user: {
                    id: '1',
                    email: 'test@example.com',
                    permissions: [] // Default user has no specific permissions
                },
                session: {}
            }),
        });

        // Mock window.location
        originalLocation = globalThis.location;
        Object.defineProperty(globalThis, 'location', {
            value: { origin: 'http://localhost:3000', search: '' },
            writable: true,
            configurable: true
        });
    });

    afterEach(() => {
        vi.unstubAllEnvs();
        Object.defineProperty(globalThis, 'location', {
            value: originalLocation,
            writable: true,
            configurable: true
        });
    });

    it('renders login form correctly', () => {
        render(<LoginPage />);
        expect(screen.getByPlaceholderText('Email')).toBeInTheDocument();
        expect(screen.getByPlaceholderText('Password')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Login' })).toBeInTheDocument();
    });

    it('redirects if user is already authenticated', () => {
        (useAuth as unknown as Mock).mockReturnValue({
            user: {
                id: '1',
                permissions: ['admin_dashboard:view'] // Admin permissions
            },
            isLoading: false,
            setAuthState: mockSetAuthState,
        });

        render(<LoginPage />);
        expect(mockNavigate).toHaveBeenCalledWith('/admin');
    });

    it('handles successful login', async () => {
        render(<LoginPage />);

        fireEvent.change(screen.getByPlaceholderText('Email'), { target: { value: 'test@example.com' } });
        fireEvent.change(screen.getByPlaceholderText('Password'), { target: { value: 'password123' } });
        fireEvent.click(screen.getByRole('button', { name: 'Login' }));

        await waitFor(() => {
            expect(globalThis.fetch).toHaveBeenCalledWith(
                expect.stringContaining('/auth/login'),
                expect.any(Object)
            );
        });

        // Strict check on body
        const fetchCall = (globalThis.fetch as Mock).mock.calls.find(call => call[0].includes('/auth/login'));
        if (!fetchCall) throw new Error("Fetch not called");
        const body = JSON.parse(fetchCall[1].body);
        expect(body).toEqual({ email: 'test@example.com', password: 'password123' });

        await waitFor(() => {
            expect(mockSetAuthState).toHaveBeenCalled();
            expect(mockNavigate).toHaveBeenCalledWith('/dashboard'); // Default fallback
        });
    });

    it('handles login failure', async () => {
        (global.fetch as Mock).mockResolvedValueOnce({
            ok: false,
            json: async () => ({ message: 'Invalid credentials' }),
        });

        render(<LoginPage />);

        fireEvent.change(screen.getByPlaceholderText('Email'), { target: { value: 'fail@example.com' } });
        fireEvent.change(screen.getByPlaceholderText('Password'), { target: { value: 'wrong' } });
        fireEvent.click(screen.getByRole('button', { name: 'Login' }));

        // Wait for error 
        await waitFor(() => {
            expect(screen.getByText('Invalid credentials')).toBeInTheDocument();
        });
        expect(mockSetAuthState).not.toHaveBeenCalled();
    });

    it('initiates social login', async () => {
        render(<LoginPage />);

        const socialLoginMock = authClient.signIn.social as unknown as Mock;
        // Mock already set in mockReturnValue, but we can override return value if needed
        socialLoginMock.mockResolvedValueOnce({});

        fireEvent.click(screen.getByText('Sign in with Google'));

        expect(socialLoginMock).toHaveBeenCalledWith(expect.objectContaining({
            provider: 'google',
            callbackURL: 'http://localhost:3000/dashboard',
        }));
    });
});
