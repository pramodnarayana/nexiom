import type { AccessControlProvider, CanParams, CanReturnType } from "@refinedev/core";
import { authProvider } from "./auth-provider";
import { hasPermission } from "../lib/auth/utils";

export const accessControlProvider: AccessControlProvider = {
    can: async ({ resource, action }: CanParams): Promise<CanReturnType> => {
        const permissions = (await authProvider.getPermissions?.()) as string[] ?? [];

        // Resource Normalization
        // Strip 'admin/' prefix to map 'admin/users' -> 'users' automatically.
        // Fallback to manual map if ever needed, or warn on unmapped.
        let targetResource = resource ?? "";

        const resourceMap: Record<string, string> = {
            // Keep distinct mappings if needed, otherwise normalization handles most
            "admin/users": "users",
            "admin/tenants": "tenants",
        };

        if (targetResource.startsWith("admin/")) {
            targetResource = targetResource.replace(/^admin\//, "");
        } else if (resourceMap[targetResource]) {
            targetResource = resourceMap[targetResource];
        }

        // Action Normalization
        // Map frontend actions to backend permissions
        const actionMap: Record<string, string> = {
            "list": "read",
            "show": "read",
            "create": "create",
            "edit": "update",
            "delete": "delete",
        };

        const rawAction = action || "manage";
        const targetAction = actionMap[rawAction] || rawAction;

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
