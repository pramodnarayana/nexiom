import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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
global.fetch = vi.fn();

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
        (global.fetch as Mock).mockResolvedValue({
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
        expect(screen.getByPlaceholderText('First Name')).toBeInTheDocument();
        expect(screen.getByPlaceholderText('Company Name')).toBeInTheDocument();
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
        expect(screen.queryByPlaceholderText('Company Name')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Join & Accept' })).toBeInTheDocument();
    });

    it('handles standard signup submission', async () => {
        // Mock alert to prevent JSDOM issues or unhandled output
        const alertMock = vi.spyOn(window, 'alert').mockImplementation(() => { });

        // Standard flow
        render(
            <MemoryRouter>
                <SignupPage />
            </MemoryRouter>
        );

        fireEvent.change(screen.getByPlaceholderText('First Name'), { target: { value: 'John' } });
        fireEvent.change(screen.getByPlaceholderText('Last Name'), { target: { value: 'Doe' } });
        fireEvent.change(screen.getByPlaceholderText('Company Name'), { target: { value: 'Acme Inc' } });
        fireEvent.change(screen.getByPlaceholderText('Work Email'), { target: { value: 'john@acme.com' } });
        fireEvent.change(screen.getByPlaceholderText('Password (min 8 chars)'), { target: { value: 'password123' } });

        fireEvent.click(screen.getByRole('button', { name: 'Sign Up' }));

        await waitFor(() => {
            expect(global.fetch).toHaveBeenCalledWith(
                expect.stringContaining('/auth/signup'),
                expect.objectContaining({
                    method: 'POST',
                    body: expect.stringContaining('"companyName":"Acme Inc"'),
                })
            );
        });

        // Wrap navigation check in waitFor to handle async microtask queue
        await waitFor(() => {
            expect(mockNavigate).toHaveBeenCalledWith('/login');
        });

        alertMock.mockRestore();
    });

    it('handles invite flow submission (auto-login)', async () => {
        const inviteUrl = `/signup?to=${encodeURIComponent('/invite/accept?id=123')}&email=invitee@example.com`;

        (global.fetch as Mock).mockResolvedValue({
            ok: true,
            json: async () => ({ session: { token: 'abc' }, user: { id: '2', permissions: [] } }),
        });

        render(
            <MemoryRouter initialEntries={[inviteUrl]}>
                <SignupPage />
            </MemoryRouter>
        );

        fireEvent.change(screen.getByPlaceholderText('First Name'), { target: { value: 'Jane' } });
        fireEvent.change(screen.getByPlaceholderText('Last Name'), { target: { value: 'Doe' } });
        fireEvent.change(screen.getByPlaceholderText('Password (min 8 chars)'), { target: { value: 'securepass' } });

        fireEvent.click(screen.getByRole('button', { name: 'Join & Accept' }));

        await waitFor(() => {
            expect(global.fetch).toHaveBeenCalledWith(
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
