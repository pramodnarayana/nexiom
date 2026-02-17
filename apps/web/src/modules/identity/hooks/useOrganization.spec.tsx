import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useOrganization } from './useOrganization';
import { apiClient } from '@/shared/lib/api-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// Mock API Client
vi.mock('@/shared/lib/api-client', () => ({
    apiClient: {
        get: vi.fn(),
    },
}));

// Setup QueryClient for testing
const createWrapper = () => {
    const queryClient = new QueryClient({
        defaultOptions: {
            queries: {
                retry: false,
            },
        },
    });
    return ({ children }: { children: React.ReactNode }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
};

describe('useOrganization', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should return null (not enabled) when id is undefined', async () => {
        const { result } = renderHook(() => useOrganization(undefined), {
            wrapper: createWrapper(),
        });

        expect(result.current.data).toBeUndefined();
        expect(result.current.fetchStatus).toBe('idle'); // Should not be fetching
        // In RQ v4/v5 enabled: false results in status: 'loading' + fetchStatus: 'idle'
        expect(apiClient.get).not.toHaveBeenCalled();
    });

    it('should fetch organization data when id is provided', async () => {
        const mockOrg = { id: '123', name: 'Test Org', slug: 'test-org' };
        vi.mocked(apiClient.get).mockResolvedValue({ data: mockOrg });

        const { result } = renderHook(() => useOrganization('123'), {
            wrapper: createWrapper(),
        });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        expect(apiClient.get).toHaveBeenCalledWith('/tenants/123');
        expect(result.current.data).toEqual(mockOrg);
    });

    it('should handle API errors', async () => {
        const error = new Error('Failed to fetch');
        vi.mocked(apiClient.get).mockRejectedValue(error);

        const { result } = renderHook(() => useOrganization('123'), {
            wrapper: createWrapper(),
        });

        await waitFor(() => expect(result.current.isError).toBe(true));

        expect(result.current.error).toBeInstanceOf(Error);
    });
});
