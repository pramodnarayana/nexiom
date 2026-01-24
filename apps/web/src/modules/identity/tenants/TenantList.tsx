import { useState, Fragment } from "react";

import { cva } from "class-variance-authority"; // Added cva
import { useAuth } from "@/lib/auth/context";

import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
    DropdownMenuLabel,
    DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, Building2, ChevronDown, MoreHorizontal, Pencil, Trash2, ExternalLink } from "lucide-react";
import { type TenantTableItem } from "./types";
import { cn } from "@/lib/utils";

interface TenantListProps {
    data: TenantTableItem[] | undefined;
    isLoading: boolean;
    onStatusChange?: (id: string, status: TenantTableItem['status']) => void;
    onEdit?: (tenant: TenantTableItem) => void;
    onDelete?: (id: string, e: React.MouseEvent) => void;
}

// Defined variants using semantic tokens for Tweakcn compatibility
const statusBadgeVariants = cva("h-6 gap-1 px-2 font-normal rounded-md border text-xs inline-flex items-center", {
    variants: {
        status: {
            active: "bg-primary/10 text-primary border-primary/20",
            disabled: "bg-muted text-muted-foreground border-transparent",
            suspended: "bg-destructive/10 text-destructive border-destructive/20",
        },
    },
    defaultVariants: {
        status: "active",
    },
});

import { TenantEdit } from "@/pages/admin/tenants/TenantEdit";

// ... previous imports

export function TenantList({ data = [], isLoading, onStatusChange, onEdit, onDelete }: Readonly<TenantListProps>) {
    const [search, setSearch] = useState("");
    const [expandedTenantId, setExpandedTenantId] = useState<string | null>(null);
    const { user } = useAuth();

    // Check if user is platform_admin (can perform write operations)
    const isPlatformAdmin = user?.systemRole === 'platform_admin';

    const filteredData = data?.filter(tenant =>
        tenant.name.toLowerCase().includes(search.toLowerCase()) ||
        tenant.slug?.toLowerCase().includes(search.toLowerCase())
    ) || [];

    if (isLoading) {
        return <div className="p-8 text-center text-muted-foreground">Loading tenants...</div>;
    }

    const handleRowClick = (id: string) => {
        setExpandedTenantId(current => current === id ? null : id);
    };

    const handleDashboardClick = (e: React.MouseEvent | React.KeyboardEvent, tenantId: string) => {
        e.stopPropagation();
        // Assuming the route is /tenants/:tenantId/dashboard as per request
        const url = `/tenants/${tenantId}/dashboard`;
        const w = window.open(url, '_blank');
        if (w) w.opener = null;
    };

    const handleRowKeyDown = (e: React.KeyboardEvent, id: string) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleRowClick(id);
        }
    };

    return (
        <div className="space-y-4">
            {/* Search Input (same) */}
            <div className="flex items-center gap-2 max-w-sm">
                <Search className="h-4 w-4 text-muted-foreground" />
                <Input
                    placeholder="Search tenants..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="h-9"
                />
            </div>

            <div className="rounded-md border">
                <Table>
                    <TableHeader>
                        <TableRow>
                            {/* Same Headers */}
                            <TableHead>Tenant</TableHead>
                            <TableHead>Slug</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>Last Updated</TableHead>
                            <TableHead>Created At</TableHead>
                            <TableHead className="w-[50px]">Link</TableHead>
                            <TableHead className="w-[80px] text-right">Actions</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {filteredData.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={7} className="h-24 text-center">
                                    No tenants found.
                                </TableCell>
                            </TableRow>
                        ) : (
                            filteredData.map((tenant) => (
                                <Fragment key={tenant.id}>
                                    <TableRow
                                        key={tenant.id}
                                        className={cn("cursor-pointer hover:bg-muted/50", expandedTenantId === tenant.id && "bg-muted/50 border-b-0")}
                                        onClick={() => handleRowClick(tenant.id)}
                                        onKeyDown={(e) => handleRowKeyDown(e, tenant.id)}
                                        tabIndex={0}
                                        role="button"
                                        aria-expanded={expandedTenantId === tenant.id}
                                    >
                                        {/* Same Cells */}
                                        <TableCell className="font-medium">
                                            <div className="flex items-center gap-2">
                                                <div className="h-8 w-8 rounded bg-primary/10 flex items-center justify-center text-primary">
                                                    <Building2 className="h-4 w-4" />
                                                </div>
                                                {tenant.name}
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-muted-foreground">{tenant.slug}</TableCell>
                                        <TableCell>
                                            {isPlatformAdmin ? (
                                                <DropdownMenu>
                                                    <DropdownMenuTrigger asChild>
                                                        <Button
                                                            variant="ghost"
                                                            size="sm"
                                                            className={cn(statusBadgeVariants({ status: tenant.status }))}
                                                            onClick={(e) => e.stopPropagation()}
                                                        >
                                                            {tenant.status.charAt(0).toUpperCase() + tenant.status.slice(1)}
                                                            <ChevronDown className="ml-1 h-3 w-3 opacity-50" />
                                                        </Button>
                                                    </DropdownMenuTrigger>
                                                    <DropdownMenuContent align="start">
                                                        <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onStatusChange?.(tenant.id, 'active'); }}>Active</DropdownMenuItem>
                                                        <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onStatusChange?.(tenant.id, 'suspended'); }}>Suspended</DropdownMenuItem>
                                                        <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onStatusChange?.(tenant.id, 'disabled'); }}>Disabled</DropdownMenuItem>
                                                    </DropdownMenuContent>
                                                </DropdownMenu>
                                            ) : (
                                                <span className={cn(statusBadgeVariants({ status: tenant.status }))}>
                                                    {tenant.status.charAt(0).toUpperCase() + tenant.status.slice(1)}
                                                </span>
                                            )}
                                        </TableCell>
                                        <TableCell>
                                            {tenant.updatedAt ? new Date(tenant.updatedAt).toLocaleDateString() : '-'}
                                        </TableCell>
                                        <TableCell>
                                            {new Date(tenant.createdAt).toLocaleDateString()}
                                        </TableCell>
                                        <TableCell>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-8 w-8 text-muted-foreground hover:text-foreground"
                                                onClick={(e) => handleDashboardClick(e, tenant.id)}
                                                title="Open Dashboard"
                                            >
                                                <ExternalLink className="h-4 w-4" />
                                            </Button>
                                        </TableCell>
                                        <TableCell className="text-right">
                                            {isPlatformAdmin && (
                                                <DropdownMenu>
                                                    <DropdownMenuTrigger asChild>
                                                        <Button
                                                            variant="ghost"
                                                            className="h-8 w-8 p-0"
                                                            onClick={(e) => e.stopPropagation()}
                                                        >
                                                            <span className="sr-only">Open menu</span>
                                                            <MoreHorizontal className="h-4 w-4" />
                                                        </Button>
                                                    </DropdownMenuTrigger>
                                                    <DropdownMenuContent align="end">
                                                        <DropdownMenuLabel>Actions</DropdownMenuLabel>
                                                        <DropdownMenuItem onClick={(e) => {
                                                            e.stopPropagation();
                                                            onEdit?.(tenant);
                                                        }}>
                                                            <Pencil className="mr-2 h-4 w-4" />
                                                            Edit Details
                                                        </DropdownMenuItem>
                                                        <DropdownMenuSeparator />
                                                        <DropdownMenuItem className="text-red-600" onClick={(e) => onDelete?.(tenant.id, e)}>
                                                            <Trash2 className="mr-2 h-4 w-4" />
                                                            Delete Tenant
                                                        </DropdownMenuItem>
                                                    </DropdownMenuContent>
                                                </DropdownMenu>
                                            )}
                                        </TableCell>
                                    </TableRow>
                                    {expandedTenantId === tenant.id && (
                                        <TableRow className="bg-muted/30 hover:bg-muted/30">
                                            <TableCell colSpan={7} className="p-0 border-t-0">
                                                <div className="p-4 border-b">
                                                    <TenantEdit
                                                        tenantId={tenant.id}
                                                        onCancel={() => setExpandedTenantId(null)}
                                                    />
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    )}
                                </Fragment>
                            ))
                        )}
                    </TableBody>
                </Table>
            </div>
        </div>
    );
}
