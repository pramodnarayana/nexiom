import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import userEvent from '@testing-library/user-event';
import { UserEdit } from './UserEdit';
import { UserShow } from './UserShow';
import { useShow } from '@refinedev/core';
import { BrowserRouter } from 'react-router-dom';

// --- Mocks ---

const mockUpdate = vi.fn();
const mockSendInvite = vi.fn();
const mockNavigate = vi.fn();
const mockToast = vi.fn();

// Mock Refine Core
const mockUseOneResult = { data: { data: { id: '1', name: 'Test User', email: 'test@example.com', emailVerified: false } }, isLoading: false };
const mockUseShowResult = {
    queryResult: { data: { data: { id: '1', name: 'Test User', email: 'test@example.com', role: 'admin', createdAt: '2023-01-01', emailVerified: true } }, isLoading: false },
    showLoading: false
};
const mockUseCanResult = { data: { can: true } };

vi.mock('@refinedev/core', () => ({
    useOne: vi.fn(() => mockUseOneResult),
    useUpdate: vi.fn(() => ({ mutate: mockUpdate, isLoading: false })),
    useParsed: vi.fn(() => ({ id: '1' })),
    useCustomMutation: vi.fn(() => ({ mutate: mockSendInvite, isLoading: false })),
    useShow: vi.fn(() => mockUseShowResult),
    useCan: vi.fn(() => mockUseCanResult),
}));

// Mock Contexts
vi.mock('@/shared/contexts/useAppScope', () => ({
    useResourceName: vi.fn(() => 'users'),
}));
vi.mock('@/shared/contexts/useBasePath', () => ({
    useBasePath: vi.fn(() => '/admin/users'),
}));

// Mock Router
vi.mock('react-router-dom', async () => {
    const actual = await vi.importActual('react-router-dom');
    return {
        ...actual,
        useNavigate: () => mockNavigate,
    };
});

// Mock Toast
vi.mock('@/shared/hooks/use-toast', () => ({
    useToast: () => ({ toast: mockToast }),
}));

// Mock UI Components (optional, but good for isolation if they are complex)
// Keeping real UI components for integration test feel, assuming they are accessible via valid imports.
// If UI components crash due to missing ShadCN providers or similar, we might need to mock them.
// For now, let's assume they work or mock the top-level Form triggers if needed.

describe('Admin User Components', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('UserEdit', () => {
        it('renders user data in form', () => {
            render(
                <BrowserRouter>
                    <UserEdit />
                </BrowserRouter>
            );

            expect(screen.getByDisplayValue('Test User')).toBeInTheDocument();
            expect(screen.getByDisplayValue('test@example.com')).toBeInTheDocument();
        });

        it('submits form updates and navigates on success', async () => {
            // Make mockUpdate invoke onSuccess callback synchronously
            mockUpdate.mockImplementationOnce((_args: unknown, options: { onSuccess?: () => void }) => {
                options?.onSuccess?.();
            });
            render(
                <BrowserRouter>
                    <UserEdit />
                </BrowserRouter>
            );

            const user = userEvent.setup();
            const nameInput = screen.getByDisplayValue('Test User');
            await user.clear(nameInput);
            await user.type(nameInput, 'Updated Name');

            const submitBtn = screen.getByText('Save Changes');
            await user.click(submitBtn);

            await waitFor(() => {
                expect(mockUpdate).toHaveBeenCalledWith(
                    expect.objectContaining({
                        resource: 'users',
                        id: '1',
                        values: expect.objectContaining({ name: 'Updated Name' })
                    }),
                    expect.anything()
                );
                expect(mockNavigate).toHaveBeenCalledWith('/admin/users');
                expect(mockToast).toHaveBeenCalledWith(
                    expect.objectContaining({
                        title: 'Success',
                        description: 'User updated successfully',
                    })
                );
            });
        });

        it('sends invitation when unverified', async () => {
            render(
                <BrowserRouter>
                    <UserEdit />
                </BrowserRouter>
            );

            const user = userEvent.setup();
            const inviteBtn = screen.getByText('Send Invite');
            expect(inviteBtn).toBeInTheDocument();

            await user.click(inviteBtn);

            await waitFor(() => {
                expect(mockSendInvite).toHaveBeenCalledWith(
                    expect.objectContaining({
                        method: 'post',
                        url: expect.stringContaining('/users/1/invite')
                    })
                );
            });
        });
    });

    // Simple test for UserShow to ensure it renders
    describe('UserShow', () => {
        it('renders user details', () => {
            render(
                <BrowserRouter>
                    <UserShow />
                </BrowserRouter>
            );

            expect(screen.getByText('User Details')).toBeInTheDocument();
            expect(screen.getByText('Test User')).toBeInTheDocument();
            expect(screen.getByText('test@example.com')).toBeInTheDocument();
        });

        it('sends invitation triggers API call', async () => {
            vi.mocked(useShow).mockReturnValueOnce({
                queryResult: {
                    data: { data: { id: '1', name: 'Test User', email: 'test@example.com', role: 'admin', createdAt: '2023-01-01', emailVerified: false } },
                    isLoading: false,
                },
                showLoading: false,
            } as any);

            render(
                <BrowserRouter>
                    <UserShow />
                </BrowserRouter>
            );

            const user = userEvent.setup();
            const inviteBtn = screen.getByText('Send Invite');
            await user.click(inviteBtn);

            await waitFor(() => {
                expect(mockSendInvite).toHaveBeenCalledWith(
                    expect.objectContaining({
                        method: 'post',
                        url: expect.stringContaining('/users/1/invite')
                    })
                );
            });
        });
    });
});
