import { useDelete } from "@refinedev/core";
import { Trash2, Edit, Eye } from "lucide-react";
import { Link } from "react-router-dom";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { type UserTableItem } from "./types";

interface UsersProps {
    data: UserTableItem[] | undefined;
    isLoading: boolean;
    basePath: string; // e.g. "/admin/users" or "/dashboard/members"
    resource?: string; // Optional override for the delete resource
}

export const Users = ({ data, isLoading, basePath, resource }: UsersProps) => {
    const { mutate: deleteUser } = useDelete();

    // Compute the resource for deletion. Fallback to basePath (trimmed) if not provided.
    const deleteResource = resource ?? basePath.replace(/^\/+|\/+$/g, '');

    const handleDelete = (id: string, name: string) => {
        if (window.confirm(`Are you sure you want to delete ${name}? This action cannot be undone.`)) {
            deleteUser({
                resource: deleteResource,
                id: id,
                mutationMode: "optimistic",
                successNotification: {
                    message: "User deleted successfully",
                    type: "success",
                },
                errorNotification: (error) => ({
                    message: `Failed to delete ${name}: ${error?.message || "unknown error"}`,
                    type: "error",
                }),
            });
        }
    };

    if (isLoading) {
        return <div className="p-4 text-sm text-muted-foreground">Loading users...</div>;
    }

    if (!data || data.length === 0) {
        return (
            <div className="p-8 text-center border rounded-md bg-slate-50">
                <p className="text-muted-foreground">No users found.</p>
            </div>
        );
    }

    return (
        <div className="rounded-md border bg-white shadow-sm">
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Email</TableHead>
                        <TableHead>Role</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Verified</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {data.map((user) => {
                        const displayName = user.name || 'user';
                        return (
                            <TableRow key={user.id}>
                                <TableCell className="font-medium">{user.name || "N/A"}</TableCell>
                                <TableCell>{user.email}</TableCell>
                                <TableCell>
                                    <div className="flex flex-col gap-1">
                                        {user.systemRole && (
                                            <Badge variant={user.systemRole === 'platform_admin' ? 'default' : 'outline'}>
                                                {user.systemRole === 'platform_admin' ? 'Platform Admin' : 'User'}
                                            </Badge>
                                        )}
                                        {user.role && user.role !== 'user' && (
                                            <Badge variant="secondary" className="text-xs w-fit">
                                                Global: {user.role}
                                            </Badge>
                                        )}
                                    </div>
                                </TableCell>
                                <TableCell>
                                    {user.status === 'pending' ? (
                                        <Badge variant="outline" className="bg-muted/50 text-muted-foreground border-border">Pending</Badge>
                                    ) : (
                                        <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20">Active</Badge>
                                    )}
                                </TableCell>
                                <TableCell>
                                    {user.status === 'pending' ? (
                                        <span className="text-muted-foreground text-xs">Waiting for acceptance</span>
                                    ) : (
                                        user.emailVerified ? (
                                            <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20">Verified</Badge>
                                        ) : (
                                            <span className="text-muted-foreground text-xs">Unverified</span>
                                        )
                                    )}
                                </TableCell>
                                <TableCell className="text-right">
                                    <div className="flex justify-end gap-2">
                                        <Button variant="ghost" size="icon" asChild aria-label={`View ${displayName}`}>
                                            <Link to={`${basePath}/show/${user.id}`}>
                                                <Eye className="h-4 w-4" />
                                            </Link>
                                        </Button>
                                        <Button variant="ghost" size="icon" asChild aria-label={`Edit ${displayName}`}>
                                            <Link to={`${basePath}/edit/${user.id}`}>
                                                <Edit className="h-4 w-4" />
                                            </Link>
                                        </Button>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="text-destructive hover:text-destructive hover:bg-destructive/10"
                                            onClick={() => handleDelete(user.id, displayName)}
                                            aria-label={`Delete ${displayName}`}
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </Button>
                                    </div>
                                </TableCell>
                            </TableRow>
                        );
                    })}
                </TableBody>
            </Table>
        </div>
    );
};
