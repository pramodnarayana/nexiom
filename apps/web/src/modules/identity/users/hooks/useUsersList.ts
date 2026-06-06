import { useState } from "react";
import { useDelete, useCustomMutation } from "@refinedev/core";
import { Actions } from "@/shared/lib/auth/constants";
import { useAuth } from "@/shared/lib/auth/context";
import { hasPermission, normalizeResource } from "@/shared/lib/auth/utils";
import { useBasePath } from "@/shared/contexts/useBasePath";

export function useUsersList(resourceOverride?: string) {
    const { mutate: deleteUser } = useDelete();
    const { mutate: sendInvite } = useCustomMutation();
    const { user: currentUser } = useAuth();
    
    const basePath = useBasePath('USERS');
    const normalizedResource = normalizeResource(resourceOverride || basePath);
    const canManageUsers = hasPermission(currentUser?.permissions, normalizedResource, Actions.MANAGE);
    const deleteResource = (resourceOverride || basePath).replaceAll(/(^\/+)|(\/+$)/g, '');

    const [invitingIds, setInvitingIds] = useState<Set<string>>(new Set());

    const handleDelete = (id: string, name: string) => {
        if (globalThis.confirm(`Are you sure you want to delete ${name}? This action cannot be undone.`)) {
            deleteUser({
                resource: deleteResource,
                id: id,
                mutationMode: "optimistic",
                successNotification: { message: "User deleted successfully", type: "success" },
                errorNotification: (error) => ({ message: `Failed to delete ${name}: ${error?.message || "unknown error"}`, type: "error" }),
            });
        }
    };

    const handleInvite = (id: string, name: string) => {
        if (invitingIds.has(id)) return;

        setInvitingIds((prev) => new Set(prev).add(id));
        const API_URL = import.meta.env.VITE_API_URL || '/api';
        const resourcePath = (resourceOverride || basePath).replaceAll(/(^\/+)|(\/+$)/g, "");
        const inviteUrl = `${API_URL}/${resourcePath}/${id}/invite`;

        sendInvite({
            url: inviteUrl,
            method: "post",
            values: {},
            successNotification: { message: `Invitation sent to ${name}`, type: "success" },
            errorNotification: (error) => ({ message: `Failed to send invite: ${error?.message || "unknown error"}`, type: "error" }),
        }, {
            onSettled: () => setInvitingIds((prev) => { const next = new Set(prev); next.delete(id); return next; })
        });
    };

    return {
        currentUser,
        basePath,
        normalizedResource,
        canManageUsers,
        invitingIds,
        handleDelete,
        handleInvite
    };
}
