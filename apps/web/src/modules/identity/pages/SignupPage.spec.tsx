import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SignupPage } from './SignupPage';
import { useAuth } from '@/shared/hooks/useAuth';
import { useNavigate, MemoryRouter } from 'react-router-dom';

// Mock Dependencies
vi.mock('@/shared/hooks/useAuth', () => ({
    useAuth: vi.fn(),
}));

vi.mock('react-router-dom', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-router-dom')>();
    return {
        ...actual,
        useNavigate: vi.fn(),
    };
});

// Setup global fetch mock
globalThis.fetch = vi.fn();

describe('SignupPage', () => {
    const mockNavigate = vi.fn();
    const mockSetAuthState = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();

        // Stub VITE_API_URL
        vi.stubGlobal('import.meta', {
            env: { VITE_API_URL: 'http://test-api.com' }
        });

        (useNavigate as unknown as Mock).mockReturnValue(mockNavigate);
        (useAuth as unknown as Mock).mockReturnValue({
            setAuthState: mockSetAuthState,
        });

        // Default fetch success
        (globalThis.fetch as Mock).mockResolvedValue({
            ok: true,
            json: async () => ({}),
        });
    });

    it('renders standard signup form', () => {
        render(
            <MemoryRouter>
                <SignupPage />
            </MemoryRouter>
        );
        expect(screen.getByPlaceholderText('Email')).toBeInTheDocument();
        expect(screen.getByPlaceholderText('Password (min 8 chars)')).toBeInTheDocument();
        // Use getByRole to avoid ambiguity with heading vs button
        expect(screen.getByRole('button', { name: 'Sign Up' })).toBeInTheDocument();
    });

    it('renders invite flow correctly', () => {
        // Mock params for invite flow via URL
        const inviteUrl = `/signup?to=${encodeURIComponent('/invite/accept?id=123')}&email=invitee@example.com`;

        render(
            <MemoryRouter initialEntries={[inviteUrl]}>
                <SignupPage />
            </MemoryRouter>
        );

        expect(screen.getByText('Join Organization')).toBeInTheDocument();
        expect(screen.getByDisplayValue('invitee@example.com')).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Join & Accept' })).toBeInTheDocument();
    });

    it('handles standard signup submission', async () => {
        const user = userEvent.setup();
        // Mock alert to prevent JSDOM issues or unhandled output
        const alertMock = vi.spyOn(globalThis, 'alert').mockImplementation(() => { });

        // Standard flow
        render(
            <MemoryRouter>
                <SignupPage />
            </MemoryRouter>
        );

        await user.type(screen.getByPlaceholderText('First Name'), 'John');
        await user.type(screen.getByPlaceholderText('Last Name'), 'Doe');
        await user.type(screen.getByPlaceholderText('Email'), 'john@acme.com');
        await user.type(screen.getByPlaceholderText('Password (min 8 chars)'), 'password123');
        await user.type(screen.getByPlaceholderText('Confirm Password'), 'password123');

        await user.click(screen.getByRole('button', { name: 'Sign Up' }));

        await waitFor(() => {
            expect(globalThis.fetch).toHaveBeenCalledWith(
                expect.stringContaining('/auth/signup'),
                expect.objectContaining({
                    method: 'POST',
                    body: expect.stringContaining('"companyName":"Acme"'),
                })
            );
        });

        // Wrap navigation check in waitFor to handle async microtask queue
        await waitFor(() => {
            expect(mockNavigate).toHaveBeenCalledWith(expect.stringContaining('/verify-email'));
        });

        alertMock.mockRestore();
    });

    it('handles invite flow submission (auto-login)', async () => {
        const user = userEvent.setup();
        console.log('Starting invite flow test');

        const inviteUrl = `/signup?to=${encodeURIComponent('/invite/accept?id=123')}&email=invitee@example.com`;

        (globalThis.fetch as Mock).mockResolvedValue({
            ok: true,
            json: async () => ({ session: { token: 'abc' }, user: { id: '2', permissions: [] } }),
        });

        render(
            <MemoryRouter initialEntries={[inviteUrl]}>
                <SignupPage />
            </MemoryRouter>
        );

        console.log('Form rendered');

        await user.type(screen.getByPlaceholderText('First Name'), 'John');
        await user.type(screen.getByPlaceholderText('Last Name'), 'Doe');
        await user.type(screen.getByPlaceholderText('Password (min 8 chars)'), 'securepass');
        await user.type(screen.getByPlaceholderText('Confirm Password'), 'securepass');

        console.log('Clicking button');
        const button = screen.getByRole('button', { name: 'Join & Accept' });
        await user.click(button);
        console.log('Button clicked');

        await waitFor(() => {
            expect(globalThis.fetch).toHaveBeenCalledWith(
                expect.stringContaining('/auth/complete-invite'),
                expect.objectContaining({
                    method: 'POST',
                    body: expect.stringContaining('"invitationId":"123"'),
                })
            );
        });

        await waitFor(() => {
            expect(mockSetAuthState).toHaveBeenCalledWith(expect.objectContaining({
                user: { id: '2', permissions: [] },
                accessToken: 'abc'
            }));
            expect(mockNavigate).toHaveBeenCalledWith('/dashboard');
        });
    });
});
