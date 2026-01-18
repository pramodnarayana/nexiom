import { useTable, useDelete } from "@refinedev/core";
import { TenantList } from "@/modules/tenants/TenantList";
import { type TenantTableItem, type TenantApiResponse } from "@/modules/tenants/types";
import { CreateTenantDialog } from "./components/CreateTenantDialog";
import { EditTenantDialog } from "./components/EditTenantDialog";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";

export const TenantListPage = () => {
    // RESOURCE: "admin/tenants" -> GET /api/admin/tenants
    const table = useTable<TenantApiResponse>({
        resource: "admin/tenants",
        syncWithLocation: true,
    });

    const { tableQueryResult } = table;
    const { data, isLoading } = tableQueryResult || {};
    const { mutate: deleteMutate } = useDelete();
    const { toast } = useToast();

    const [editDialogOpen, setEditDialogOpen] = useState(false);
    const [selectedTenant, setSelectedTenant] = useState<TenantTableItem | null>(null);

    // Transform API response to UI model
    const tenants: TenantTableItem[] = data?.data?.map((org: TenantApiResponse) => ({
        id: org.id,
        name: org.name,
        slug: org.slug,
        logo: org.logo,
        createdAt: new Date(org.createdAt),
        metadata: org.metadata,
        status: org.status,
    })) || [];

    const handleEdit = (tenant: TenantTableItem) => {
        setSelectedTenant(tenant);
        setEditDialogOpen(true);
    };

    const handleDelete = (id: string) => {
        if (confirm("Are you sure you want to delete this tenant? This action cannot be undone.")) {
            deleteMutate({
                resource: "admin/tenants",
                id,
            }, {
                onSuccess: () => {
                    toast({
                        title: "Tenant deleted",
                        description: "The tenant has been successfully removed.",
                    });
                },
                onError: (error) => {
                    toast({
                        title: "Error",
                        description: error?.message || "Failed to delete tenant.",
                        variant: "destructive"
                    });
                }
            });
        }
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
                <CreateTenantDialog />
            </div>

            <TenantList
                data={tenants}
                isLoading={isLoading}
                onEdit={handleEdit}
                onDelete={handleDelete}
            />

            <EditTenantDialog
                open={editDialogOpen}
                onOpenChange={setEditDialogOpen}
                tenant={selectedTenant ? {
                    ...selectedTenant,
                    logo: selectedTenant.logo || undefined
                } : null}
            />

            <div className="flex items-center justify-end space-x-2 py-4">
                <div className="text-xs text-muted-foreground mr-4">
                    Total: {data?.total || 0}
                </div>
            </div>
        </div>
    );
};
