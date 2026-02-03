import * as React from "react";
import { useDelete, useCustomMutation } from "@refinedev/core";
import { Trash2, Edit, Eye, Send, Loader2 } from "lucide-react";
import { Link } from "react-router-dom";
import { useAuth } from "@/shared/lib/auth/context";
import { hasPermission } from "@/shared/lib/auth/utils";
import { Actions, Resources } from "@/shared/lib/auth/constants";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/shared/components/ui/table";
import { Button } from "@/shared/components/ui/button";
import { Badge } from "@/shared/components/ui/badge";
import { type UserTableItem } from "./types";

interface UsersProps {
    data: UserTableItem[] | undefined;
    isLoading: boolean;
    basePath: string; // e.g. "/admin/users" or "/dashboard/members"
    resource?: string; // Optional override for the delete resource
}

export const Users = ({ data, isLoading, basePath, resource }: UsersProps) => {
    const { mutate: deleteUser } = useDelete();
    const { mutate: sendInvite } = useCustomMutation();
    const { user: currentUser } = useAuth();

    // Check if user is platform_admin (can perform write operations)
    // PBAC: Check if user can manage users
    const canManageUsers = hasPermission(currentUser?.permissions, Resources.USERS, Actions.MANAGE);

    // Compute the resource for deletion. Fallback to basePath (trimmed) if not provided.
    const deleteResource = (resource || basePath).replace(/^\/+|\/+$/g, '');

    const handleDelete = (id: string, name: string) => {
        if (globalThis.confirm(`Are you sure you want to delete ${name}? This action cannot be undone.`)) {
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

    const [invitingIds, setInvitingIds] = React.useState<Set<string>>(new Set());

    const handleInvite = (id: string, name: string) => {
        if (invitingIds.has(id)) return;

        setInvitingIds((prev) => new Set(prev).add(id));
        const API_URL = import.meta.env.VITE_API_URL || '/api';

        // Derive endpoint from resource prop or default to admin/users
        // Ensure we don't duplicate slashes if resource has them
        const resourcePath = (resource || "admin/users").replace(/^\/+|\/+$/g, "");
        const inviteUrl = `${API_URL}/${resourcePath}/${id}/invite`;

        sendInvite({
            url: inviteUrl,
            method: "post",
            values: {},
            successNotification: {
                message: `Invitation sent to ${name}`,
                type: "success",
            },
            errorNotification: (error) => ({
                message: `Failed to send invite: ${error?.message || "unknown error"}`,
                type: "error",
            }),
        }, {
            onSettled: () => {
                setInvitingIds((prev) => {
                    const next = new Set(prev);
                    next.delete(id);
                    return next;
                });
            }
        });
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
                        const isInviting = invitingIds.has(user.id);
                        const isSelf = currentUser?.id === user.id;
                        return (
                            <TableRow key={user.id}>
                                <TableCell className="font-medium">{user.name || "N/A"}</TableCell>
                                <TableCell>{user.email}</TableCell>
                                <TableCell>
                                    <div className="flex flex-col gap-1">
                                        {/* Display Role Logic would go here - for now relying on user.role */}
                                        {user.role && (
                                            <Badge variant={user.role === 'admin' || user.role === 'owner' ? 'default' : 'secondary'} className="text-xs w-fit capitalize">
                                                {user.role}
                                            </Badge>
                                        )}
                                    </div>
                                </TableCell>
                                <TableCell>
                                    {(() => {
                                        switch (user.status) {
                                            case 'pending':
                                                return <Badge variant="outline" className="bg-muted/50 text-muted-foreground border-border">Pending</Badge>;
                                            case 'disabled':
                                                return <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/20">Disabled</Badge>;
                                            case 'suspended':
                                                return <Badge variant="outline" className="bg-orange-50 text-orange-600 border-orange-200">Suspended</Badge>;
                                            case 'active':
                                            default:
                                                return <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20">Active</Badge>;
                                        }
                                    })()}
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
                                        {!user.emailVerified && user.status !== 'pending' && canManageUsers && (
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                onClick={() => handleInvite(user.id, displayName)}
                                                disabled={isInviting}
                                                title="Send Invitation"
                                            >
                                                {isInviting ? (
                                                    <Loader2 className="h-4 w-4 animate-spin" />
                                                ) : (
                                                    <Send className="h-4 w-4" />
                                                )}
                                            </Button>
                                        )}
                                        <Button variant="ghost" size="icon" asChild aria-label={`View ${displayName}`}>
                                            <Link to={`${basePath}/show/${user.id}`}>
                                                <Eye className="h-4 w-4" />
                                            </Link>
                                        </Button>
                                        {canManageUsers && (
                                            <>
                                                <Button variant="ghost" size="icon" asChild aria-label={`Edit ${displayName}`}>
                                                    <Link to={`${basePath}/edit/${user.id}`}>
                                                        <Edit className="h-4 w-4" />
                                                    </Link>
                                                </Button>
                                                {!isSelf && (
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        className="text-destructive hover:text-destructive hover:bg-destructive/10"
                                                        onClick={() => handleDelete(user.id, displayName)}
                                                        aria-label={`Delete ${displayName}`}
                                                    >
                                                        <Trash2 className="h-4 w-4" />
                                                    </Button>
                                                )}
                                            </>
                                        )}
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
