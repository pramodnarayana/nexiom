import { useTable, useDelete, useCan } from "@refinedev/core";
import { TenantList } from "@/modules/identity/tenants/TenantList";
import { type TenantTableItem, type TenantApiResponse } from "@/modules/identity/tenants/types";
import { CreateTenantDialog } from "./components/CreateTenantDialog";
import { useState } from "react";
import { useToast } from "@/shared/hooks/use-toast";
import { useNavigate } from "react-router-dom";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/shared/components/ui/dialog";
import { Button } from "@/shared/components/ui/button";

export const TenantListPage = () => {
    const navigate = useNavigate();

    // Permission Check
    const { data: canCreate } = useCan({
        resource: "admin/tenants",
        action: "create",
    });

    // RESOURCE: "admin/tenants" -> GET /api/admin/tenants
    const table = useTable<TenantApiResponse>({
        resource: "admin/tenants",
        syncWithLocation: true,
    });

    const { tableQueryResult } = table;
    const { data, isLoading } = tableQueryResult || {};
    const { mutate: deleteMutate } = useDelete();
    const { toast } = useToast();

    // Delete dialog state
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

    // Transform API response to UI model
    const tenants: TenantTableItem[] = data?.data?.map((org: TenantApiResponse) => {
        return {
            id: org.id,
            name: org.name,
            slug: org.slug,
            logo: org.logo,
            createdAt: new Date(org.createdAt),
            updatedAt: new Date(org.updatedAt || org.createdAt), // Handle missing updatedAt if any
            metadata: org.metadata,
            status: org.status,
            isSystem: org.isSystem,
        };
    }) || [];

    const handleEdit = (tenant: TenantTableItem) => {
        navigate(`/admin/tenants/${tenant.id}`);
    };

    const handleDelete = (id: string, e?: React.MouseEvent) => {
        e?.stopPropagation(); // Prevent row click
        setPendingDeleteId(id);
        setConfirmOpen(true);
    };

    const onConfirmDelete = () => {
        if (!pendingDeleteId) return;

        deleteMutate({
            resource: "admin/tenants",
            id: pendingDeleteId,
        }, {
            onSuccess: () => {
                setConfirmOpen(false);
                setPendingDeleteId(null);
                toast({
                    title: "Tenant deleted",
                    description: "The tenant has been successfully removed.",
                });
            },
            onError: (error) => {
                setConfirmOpen(false);
                setPendingDeleteId(null);
                toast({
                    title: "Error",
                    description: error?.message || "Failed to delete tenant.",
                    variant: "destructive"
                });
            }
        });
    };

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-2xl font-bold tracking-tight">Tenants</h2>
                </div>
                {canCreate?.can && <CreateTenantDialog />}
            </div>

            <TenantList
                data={tenants}
                isLoading={isLoading}
                onEdit={handleEdit}
                onDelete={handleDelete}
            />

            <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Delete Tenant</DialogTitle>
                        <DialogDescription>
                            Are you sure you want to delete this tenant? This action cannot be undone.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setConfirmOpen(false)}>Cancel</Button>
                        <Button variant="destructive" onClick={onConfirmDelete}>Delete</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <div className="flex items-center justify-end space-x-2 py-4">
                <div className="text-xs text-muted-foreground mr-4">
                    Total: {data?.total || 0}
                </div>
            </div>
        </div>
    );
};
