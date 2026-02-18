import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { UserProfilePage } from './UserProfilePage';
import { useAuth } from '@/shared/lib/auth/context';

// Mock useAuth
vi.mock('@/shared/lib/auth/context', () => ({
    useAuth: vi.fn(),
}));

describe('UserProfilePage', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders user profile correctly', () => {
        vi.mocked(useAuth).mockReturnValue({
            user: {
                id: '123',
                email: 'test@example.com',
                name: 'Test User',
                roles: ['admin'],
            },
            isAuthenticated: true,
            isLoading: false,
            login: function (): Promise<void> {
                throw new Error('Function not implemented.');
            },
            signup: function (): void {
                throw new Error('Function not implemented.');
            },
            logout: function (): void {
                throw new Error('Function not implemented.');
            },
            setAuthState: function (): void {
                throw new Error('Function not implemented.');
            },
            refreshSession: function (): Promise<void> {
                throw new Error('Function not implemented.');
            }
        });

        render(<UserProfilePage />);

        expect(screen.getByText('My Profile')).toBeInTheDocument();
        expect(screen.getByText('Test User')).toBeInTheDocument();
        expect(screen.getByText('test@example.com')).toBeInTheDocument();
        expect(screen.getByText('123')).toBeInTheDocument();
        expect(screen.getByText('admin')).toBeInTheDocument();
    });

    it('renders null if no user', () => {
        (useAuth as ReturnType<typeof vi.fn>).mockReturnValue({
            user: null,
        });

        const { container } = render(<UserProfilePage />);
        expect(container).toBeEmptyDOMElement();
    });

    it('renders default fallback for name', () => {
        (useAuth as ReturnType<typeof vi.fn>).mockReturnValue({
            user: {
                id: '123',
                email: 'test@example.com',
                roles: [],
            },
        });

        render(<UserProfilePage />);
        expect(screen.getByText('No Name Set')).toBeInTheDocument();
        expect(screen.getByText('Member')).toBeInTheDocument(); // Default role display
    });
});
