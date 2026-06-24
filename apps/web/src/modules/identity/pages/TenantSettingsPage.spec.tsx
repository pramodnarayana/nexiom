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

        // See handlers.ts for GET /api/tenants/:id handler returning 'Test Organization'
        await screen.findByDisplayValue('Test Organization', {}, { timeout: 3000 });
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

        // See handlers.ts for GET /api/tenants/:id handler returning 'Test Organization'
        const companyInput = await screen.findByDisplayValue('Test Organization', {}, { timeout: 3000 });

        fireEvent.change(companyInput, { target: { value: 'Updated Corp' } });

        const saveBtn = screen.getByText('Save');
        fireEvent.click(saveBtn);

        await waitFor(() => {
            // See handlers.ts for PATCH /api/tenants/:id/details success response
            expect(mockToast).toHaveBeenCalledWith(
                expect.objectContaining({
                    title: "Organization updated",
                })
            );
        });
    });
});
