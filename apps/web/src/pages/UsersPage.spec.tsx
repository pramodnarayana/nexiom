import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { UsersPage } from './UsersPage';
import { useAuth } from '../hooks/useAuth';
import { authorizedFetch } from '../lib/api';

// Mock Dependencies
vi.mock('../hooks/useAuth', () => ({
    useAuth: vi.fn(),
}));

vi.mock('../lib/api', () => ({
    authorizedFetch: vi.fn(),
}));

describe('UsersPage', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (useAuth as unknown as Mock).mockReturnValue({ token: 'test-token' });
        (authorizedFetch as Mock).mockResolvedValue([]);
    });

    it('renders user list (empty state)', async () => {
        render(<UsersPage />);
        expect(screen.getByText('User Management')).toBeInTheDocument();

        await waitFor(() => {
            expect(screen.getByText('No users found (or loading...)')).toBeInTheDocument();
        });
        expect(authorizedFetch).toHaveBeenCalledWith('test-token', '/users');
    });

    it('renders user list with data', async () => {
        const users = [
            { id: '1', email: 'user1@example.com', role: 'admin' },
            { id: '2', email: 'user2@example.com', roleId: 'viewer' },
        ];
        (authorizedFetch as Mock).mockResolvedValueOnce(users);

        render(<UsersPage />);

        await waitFor(() => {
            expect(screen.getByText('user1@example.com')).toBeInTheDocument();
            expect(screen.getByText('user2@example.com')).toBeInTheDocument();
        });
    });

    it('handles adding a user', async () => {
        render(<UsersPage />);

        fireEvent.change(screen.getByPlaceholderText('user@example.com'), { target: { value: 'new@example.com' } });
        fireEvent.change(screen.getByRole('combobox'), { target: { value: 'editor' } }); // Select role

        (authorizedFetch as Mock).mockResolvedValueOnce({}); // Success for POST

        fireEvent.click(screen.getByRole('button', { name: 'Add User' }));

        await waitFor(() => {
            expect(authorizedFetch).toHaveBeenCalledWith('test-token', '/users', expect.objectContaining({
                method: 'POST',
                body: expect.stringContaining('new@example.com')
            }));
            expect(screen.getByText('User added successfully!')).toBeInTheDocument();
        });
    });

    it('handles add user failure', async () => {
        // Prevent console error from polluting output (since the component logs it)
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => { });

        render(<UsersPage />);

        (authorizedFetch as Mock).mockImplementation((_token, _url, options) => {
            if (options && options.method === 'POST') {
                return Promise.reject(new Error('Fetch Failed'));
            }
            return Promise.resolve([]); // Default GET response
        });

        fireEvent.change(screen.getByPlaceholderText('user@example.com'), { target: { value: 'fail@example.com' } });
        fireEvent.click(screen.getByRole('button', { name: 'Add User' }));

        await waitFor(() => {
            expect(screen.getByText('Error: Fetch Failed')).toBeInTheDocument();
        });

        consoleSpy.mockRestore();
    });
});
