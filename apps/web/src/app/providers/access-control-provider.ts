import type { AccessControlProvider, CanParams, CanReturnType } from "@refinedev/core";
import { authProvider } from "./auth-provider";
import { hasPermission } from "@/shared/lib/auth/utils";

// Resource Normalization Map
// Strip 'admin/' prefix to map 'admin/users' -> 'users' automatically.
const RESOURCE_MAP: Record<string, string> = {
    // Keep distinct mappings if needed, otherwise normalization handles most
    "admin/users": "system_users",
    "admin/tenants": "system_tenants",
};

// Action Normalization Map
// Map frontend actions to backend permissions
const ACTION_MAP: Record<string, string> = {
    "list": "read",
    "show": "read",
    "edit": "update",
};

export const accessControlProvider: AccessControlProvider = {
    can: async ({ resource, action }: CanParams): Promise<CanReturnType> => {
        const permissions = (await authProvider.getPermissions?.()) as string[] ?? [];

        // Resource Normalization
        let targetResource = resource ?? "";

        if (RESOURCE_MAP[targetResource]) {
            targetResource = RESOURCE_MAP[targetResource];
        } else if (targetResource.startsWith("admin/")) {
            targetResource = targetResource.replace(/^admin\//, "");
        }

        // Action Normalization
        const rawAction = action || "manage";
        const targetAction = ACTION_MAP[rawAction] || rawAction;

        // Use Shared Utility
        // Matches strict logic: *, resource:action, resource:*, *:action
        const canAccess = hasPermission(permissions, targetResource, targetAction);

        if (canAccess) {
            return { can: true };
        }

        return {
            can: false,
            reason: `Missing permission: ${targetResource}:${targetAction}`,
        };
    },
};
