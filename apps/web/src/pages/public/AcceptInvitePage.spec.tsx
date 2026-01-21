import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { AcceptInvitePage } from './AcceptInvitePage';
import { useAuth } from '@/hooks/useAuth';
import { useNavigate, useSearchParams } from 'react-router-dom';

// Mock Dependencies
vi.mock('@/hooks/useAuth', () => ({
    useAuth: vi.fn(),
}));

vi.mock('react-router-dom', () => ({
    useNavigate: vi.fn(),
    useSearchParams: vi.fn(),
}));

// Mock UI components (shallow render mostly, but since we use happy-dom, full render is fine)
// Card etc are just divs usually.

// Setup global fetch mock
global.fetch = vi.fn();

describe('AcceptInvitePage', () => {
    const mockNavigate = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        (useNavigate as unknown as Mock).mockReturnValue(mockNavigate);
        (useAuth as unknown as Mock).mockReturnValue({
            user: null,
            isLoading: false,
            token: null
        });
        // Default valid params
        (useSearchParams as unknown as Mock).mockReturnValue([new URLSearchParams('id=123')]);

        // Default fetch success
        (global.fetch as Mock).mockResolvedValue({
            ok: true,
            json: async () => ({}),
        });
    });

    it('renders error state when invite ID is missing', () => {
        (useSearchParams as unknown as Mock).mockReturnValue([new URLSearchParams('')]);

        render(<AcceptInvitePage />);
        expect(screen.getByText('Action Required')).toBeInTheDocument();
        expect(screen.getByText('Invitation Missing')).toBeInTheDocument();
        expect(screen.getByText(/No invitation ID found/)).toBeInTheDocument();
    });

    it('redirects to signup when user is not logged in', () => {
        // User null, isLoading false. ID is present.
        render(<AcceptInvitePage />);

        // Should check navigate call
        const expectedTarget = `/signup?to=${encodeURIComponent('/invite/accept?id=123')}&email=`;
        expect(mockNavigate).toHaveBeenCalledWith(expectedTarget, { replace: true });

        // Should verify loader is present
        // Note: The component renders loader while effect triggers redirect
        // Ideally we check if text is NOT invalid link
        expect(screen.queryByText('Invalid Link')).not.toBeInTheDocument();
    });

    it('redirects to signup with email param if provided', () => {
        const params = new URLSearchParams();
        params.set('id', '456');
        params.set('email', 'test@example.com');
        (useSearchParams as unknown as Mock).mockReturnValue([params]);

        render(<AcceptInvitePage />);

        const expectedTarget = `/signup?to=${encodeURIComponent('/invite/accept?id=456')}&email=${encodeURIComponent('test@example.com')}`;
        expect(mockNavigate).toHaveBeenCalledWith(expectedTarget, { replace: true });
    });

    it('performs silent accept when user is logged in', async () => {
        (useAuth as unknown as Mock).mockReturnValue({
            user: { id: 'u1' },
            isLoading: false,
            token: 'valid-token'
        });

        render(<AcceptInvitePage />);

        // Should call fetch
        await waitFor(() => {
            expect(global.fetch).toHaveBeenCalledWith(
                expect.stringContaining('/invitations/accept'),
                expect.objectContaining({
                    method: 'POST',
                    headers: expect.objectContaining({
                        Authorization: 'Bearer valid-token',
                    }),
                    body: JSON.stringify({ invitationId: '123' }),
                })
            );
        });

        // Should redirect to dashboard
        await waitFor(() => {
            expect(mockNavigate).toHaveBeenCalledWith('/dashboard', { replace: true });
        });
    });

    it('proceeds to dashboard even if silent accept fails (idempotency)', async () => {
        (useAuth as unknown as Mock).mockReturnValue({
            user: { id: 'u1' },
            isLoading: false,
            token: 'valid-token'
        });

        (global.fetch as Mock).mockRejectedValueOnce(new Error('Network Error'));

        render(<AcceptInvitePage />);

        await waitFor(() => {
            expect(global.fetch).toHaveBeenCalled();
        });

        // Still navigates
        await waitFor(() => {
            expect(mockNavigate).toHaveBeenCalledWith('/dashboard', { replace: true });
        });
    });

    it('waits for loading state before acting', () => {
        (useAuth as unknown as Mock).mockReturnValue({
            user: null, // or whatever
            isLoading: true,
            token: null
        });

        render(<AcceptInvitePage />);

        // Should NOT navigate yet
        expect(mockNavigate).not.toHaveBeenCalled();
        // Should NOT fetch
        expect(global.fetch).not.toHaveBeenCalled();
    });
});
