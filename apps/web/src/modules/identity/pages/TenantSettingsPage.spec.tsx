import { renderWithClient } from '@/test/utils';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TenantSettingsPage } from './TenantSettingsPage';
import { useAuth } from '@/shared/lib/auth/context';

// Mock useAuth
vi.mock('@/shared/lib/auth/context', () => ({
    useAuth: vi.fn(),
}));

// Mock useToast
const mockToast = vi.fn();
vi.mock('@/shared/hooks/use-toast', () => ({
    useToast: () => ({ toast: mockToast }),
}));

describe('TenantSettingsPage', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders with organization data', async () => {
        (useAuth as ReturnType<typeof vi.fn>).mockReturnValue({
            user: { organizationId: '123' }, // handler is /api/tenants/:id, so any ID should work if handler is correct
        });

        renderWithClient(<TenantSettingsPage />);

        // Wait for loading to finish
        await waitFor(() => {
            expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
        });

        expect(screen.getByDisplayValue('Test Organization')).toBeInTheDocument();
    });

    it('shows error if no organization context', () => {
        (useAuth as ReturnType<typeof vi.fn>).mockReturnValue({
            user: { organizationId: null },
        });

        renderWithClient(<TenantSettingsPage />);

        expect(screen.getByText('You do not have an organization context.')).toBeInTheDocument();
    });

    it('updates organization settings', async () => {
        (useAuth as ReturnType<typeof vi.fn>).mockReturnValue({
            user: { organizationId: 'test-org-id' },
        });

        renderWithClient(<TenantSettingsPage />);

        await waitFor(() => {
            expect(screen.getByDisplayValue('Test Organization')).toBeInTheDocument();
        });

        const input = screen.getByLabelText('Company Name');
        fireEvent.change(input, { target: { value: 'Updated Corp' } });

        const saveBtn = screen.getByText('Save');
        fireEvent.click(saveBtn);

        await waitFor(() => {
            expect(mockToast).toHaveBeenCalledWith(
                expect.objectContaining({
                    title: "Organization updated",
                })
            );
        });
    });
});
