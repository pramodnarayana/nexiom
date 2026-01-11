import { useState } from "react";
import { Link } from "react-router-dom";
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
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, Settings, Building2, ChevronDown } from "lucide-react";
import { type TenantTableItem } from "./types";
import { cn } from "@/lib/utils";

interface TenantListProps {
    data: TenantTableItem[] | undefined;
    isLoading: boolean;
    onStatusChange?: (id: string, status: TenantTableItem['status']) => void;
}

export function TenantList({ data = [], isLoading, onStatusChange }: TenantListProps) {
    const [search, setSearch] = useState("");

    const filteredData = data?.filter(tenant =>
        tenant.name.toLowerCase().includes(search.toLowerCase()) ||
        tenant.slug?.toLowerCase().includes(search.toLowerCase())
    ) || [];

    const getStatusColor = (status: TenantTableItem['status']) => {
        switch (status) {
            case 'active': return "bg-green-100 text-green-800 hover:bg-green-100";
            case 'disabled': return "bg-gray-100 text-gray-800 hover:bg-gray-100";
            case 'suspended': return "bg-red-100 text-red-800 hover:bg-red-100";
            default: return "bg-gray-100 text-gray-800";
        }
    };

    if (isLoading) {
        return <div className="p-8 text-center text-muted-foreground">Loading tenants...</div>;
    }

    return (
        <div className="space-y-4">
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
                            <TableHead>Tenant</TableHead>
                            <TableHead>Slug</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>Created At</TableHead>
                            <TableHead className="w-[100px] text-right">Actions</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {filteredData.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={5} className="h-24 text-center">
                                    No tenants found.
                                </TableCell>
                            </TableRow>
                        ) : (
                            filteredData.map((tenant) => (
                                <TableRow key={tenant.id}>
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
                                        <DropdownMenu>
                                            <DropdownMenuTrigger asChild>
                                                <Button variant="ghost" size="sm" className={cn("h-6 gap-1 px-2 font-normal", getStatusColor(tenant.status))}>
                                                    {tenant.status.charAt(0).toUpperCase() + tenant.status.slice(1)}
                                                    <ChevronDown className="h-3 w-3 opacity-50" />
                                                </Button>
                                            </DropdownMenuTrigger>
                                            <DropdownMenuContent align="start">
                                                <DropdownMenuItem onClick={() => onStatusChange?.(tenant.id, 'active')}>
                                                    Active
                                                </DropdownMenuItem>
                                                <DropdownMenuItem onClick={() => onStatusChange?.(tenant.id, 'suspended')}>
                                                    Suspended
                                                </DropdownMenuItem>
                                                <DropdownMenuItem onClick={() => onStatusChange?.(tenant.id, 'disabled')}>
                                                    Disabled
                                                </DropdownMenuItem>
                                            </DropdownMenuContent>
                                        </DropdownMenu>
                                    </TableCell>
                                    <TableCell>
                                        {new Date(tenant.createdAt).toLocaleDateString()}
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <Button variant="ghost" size="icon" asChild>
                                            <Link to={`/admin/tenants/${tenant.id}`}>
                                                <Settings className="h-4 w-4" />
                                            </Link>
                                        </Button>
                                    </TableCell>
                                </TableRow>
                            ))
                        )}
                    </TableBody>
                </Table>
            </div>
        </div>
    );
}
