import { useTable } from "@refinedev/core";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { TenantList } from "@/modules/tenants/TenantList";
import { type TenantTableItem, type OrganizationApiResponse } from "@/modules/tenants/types";

export const TenantListPage = () => {
    // RESOURCE: "organizations" -> GET /api/organizations
    const table = useTable<OrganizationApiResponse>({
        resource: "organizations",
        syncWithLocation: true,
        // Optional: Add sorters/filters initial state if needed
    });

    const { tableQueryResult } = table;
    const { data, isLoading } = tableQueryResult || {};

    // Transform API response to UI model
    // Assuming API returns standard Refine shape: { data: [...], total: N }
    const tenants: TenantTableItem[] = data?.data?.map((org: OrganizationApiResponse) => ({
        id: org.id,
        name: org.name,
        slug: org.slug,
        logo: org.logo,
        createdAt: new Date(org.createdAt),
        metadata: org.metadata,
        status: org.status || 'active', // Fallback if API hasn't updated yet
    })) || [];

    const handleStatusChange = (id: string, status: TenantTableItem['status']) => {
        // TODO: Wire up to update hook
        console.log("Updating status:", id, status);
    };

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-2xl font-bold tracking-tight">Tenants</h2>
                    <p className="text-muted-foreground">
                        Manage organizations and their statuses.
                    </p>
                </div>
                <Button>
                    <Plus className="mr-2 h-4 w-4" />
                    Create Tenant
                </Button>
            </div>

            <TenantList
                data={tenants}
                isLoading={isLoading}
                onStatusChange={handleStatusChange}
            />

            <div className="flex items-center justify-end space-x-2 py-4">
                <div className="text-xs text-muted-foreground mr-4">
                    Total: {data?.total || 0}
                </div>
            </div>
        </div>
    );
};
