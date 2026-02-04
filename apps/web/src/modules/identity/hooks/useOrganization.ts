
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/shared/lib/api-client';

export interface Organization {
    id: string;
    name: string;
    slug: string;
}

export function useOrganization(id?: string) {
    return useQuery({
        queryKey: ['organization', id],
        queryFn: async () => {
            if (!id) return null;
            const res = await apiClient.get<Organization>(`/tenants/${id}`);
            return res.data;
        },
        enabled: !!id,
        staleTime: 5 * 60 * 1000, // Data is fresh for 5 minutes
    });
}
