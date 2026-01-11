import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router-dom';
import { TenantList } from './TenantList';
import { type TenantTableItem } from './types';
import { describe, it, expect, vi, beforeAll } from 'vitest';

// Mock ResizeObserver and scrollIntoView for Radix UI
beforeAll(() => {
    window.ResizeObserver = vi.fn().mockImplementation(() => ({
        observe: vi.fn(),
        unobserve: vi.fn(),
        disconnect: vi.fn(),
    }));
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
    window.HTMLElement.prototype.hasPointerCapture = vi.fn();
    window.HTMLElement.prototype.releasePointerCapture = vi.fn();
});

describe('TenantList Component', () => {
    const mockData: TenantTableItem[] = [
        {
            id: '1',
            name: 'Acme Corp',
            slug: 'acme',
            logo: null,
            status: 'active',
            createdAt: new Date('2023-01-01'),
            metadata: null
        },
        {
            id: '2',
            name: 'Beta Inc',
            slug: 'beta',
            logo: null,
            status: 'suspended',
            createdAt: new Date('2023-02-01'),
            metadata: null
        }
    ];

    const renderComponent = (props: Partial<React.ComponentProps<typeof TenantList>> = {}) => {
        return render(
            <BrowserRouter>
                <TenantList
                    data={mockData}
                    isLoading={false}
                    {...props}
                />
            </BrowserRouter>
        );
    };

    it('renders loading state', () => {
        renderComponent({ isLoading: true });
        expect(screen.getByText('Loading tenants...')).toBeInTheDocument();
    });

    it('renders empty state', () => {
        renderComponent({ data: [] });
        expect(screen.getByText('No tenants found.')).toBeInTheDocument();
    });

    it('renders tenant data correctly', () => {
        renderComponent();
        expect(screen.getByText('Acme Corp')).toBeInTheDocument();
        expect(screen.getByText('acme')).toBeInTheDocument();
        expect(screen.getByText('Active')).toBeInTheDocument();

        expect(screen.getByText('Beta Inc')).toBeInTheDocument();
        expect(screen.getByText('Suspended')).toBeInTheDocument();
    });

    it('filters data by search term', async () => {
        const user = userEvent.setup();
        renderComponent();
        const searchInput = screen.getByPlaceholderText('Search tenants...');

        await user.type(searchInput, 'beta');

        expect(screen.queryByText('Acme Corp')).not.toBeInTheDocument();
        expect(screen.getByText('Beta Inc')).toBeInTheDocument();
    });


});
