import type { AccessControlProvider, CanParams, CanReturnType } from "@refinedev/core";
import { authProvider } from "./auth-provider";
import { hasPermission } from "../lib/auth/utils";

export const accessControlProvider: AccessControlProvider = {
    can: async ({ resource, action }: CanParams): Promise<CanReturnType> => {
        const permissions = (await authProvider.getPermissions?.()) as string[] ?? [];

        let targetResource = resource ?? "";
        // Map frontend resources to backend RBAC resources
        // Note: Backend seed uses "users", "tenants". Frontend uses "admin/users", "admin/tenants".
        const resourceMap: Record<string, string> = {
            "admin/users": "users",
            "admin/tenants": "tenants",
            "users": "users",
            "tenants": "tenants",
        };
        if (resource && resourceMap[resource]) {
            targetResource = resourceMap[resource];
        }

        const targetAction = action || "manage";

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
