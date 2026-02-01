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
            email: vi.fn(),
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

        // Mock authClient.signIn.email default success
        (authClient.signIn.email as unknown as Mock).mockResolvedValue({
            data: { user: { id: '1' }, session: { token: 'valid-token' } },
            error: null
        });

        // Default fetch mock (for refresh-session) to success
        (globalThis.fetch as Mock).mockResolvedValue({
            ok: true,
            json: async () => ({
                user: {
                    id: '1',
                    email: 'test@example.com',
                    permissions: [] // Default user has no specific permissions
                },
                session: { token: 'enriched-token' }
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
            // 1. Check authClient call
            expect(authClient.signIn.email).toHaveBeenCalledWith({
                email: 'test@example.com',
                password: 'password123'
            });

            // 2. Check refresh-session fetch
            expect(globalThis.fetch).toHaveBeenCalledWith(
                'http://test-api.com/auth/refresh-session',
                expect.objectContaining({ credentials: 'include' })
            );
        });

        await waitFor(() => {
            expect(mockSetAuthState).toHaveBeenCalledWith({
                accessToken: 'enriched-token',
                user: expect.objectContaining({ id: '1' })
            });
            expect(mockNavigate).toHaveBeenCalledWith('/dashboard'); // Default fallback
        });
    });

    it('handles login failure', async () => {
        // Mock authClient failure
        (authClient.signIn.email as unknown as Mock).mockResolvedValueOnce({
            data: null,
            error: { message: 'Invalid credentials' }
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
            callbackURL: 'http://localhost:3000/auth/callback',
        }));
    });
});
