import type { AccessControlProvider, CanParams, CanReturnType } from "@refinedev/core";
import { authProvider } from "./auth-provider";

export const accessControlProvider: AccessControlProvider = {
    can: async ({ resource, action }: CanParams): Promise<CanReturnType> => {
        // Fetch permissions fresh (or cached by AuthProvider/Client)
        // Note: authProvider.getPermissions is implemented now.
        // We cast to string[] strictly.
        const permissions = (await authProvider.getPermissions?.()) as string[] ?? [];

        // Admin Bypass (Optional: if 'platform_admin' role implies *, but our backend 
        // sends '*' in permissions list for admins anyway).
        if (permissions.includes("*")) {
            return { can: true };
        }

        // Map Refine actions to our RBAC verbs
        // Refine: list, show, create, edit, delete
        // RBAC: read, manage (invite is specific)

        let requiredAction = "manage"; // Default to high security
        if (action === "list" || action === "show") {
            requiredAction = "read";
        }

        // Handling special resource names if they differ from backend
        // e.g. "admin/users" -> "system_users" (or "users")
        // My AdminRoutes uses "admin/users".
        // My Seed Script uses "system_users" and "users".
        // Let's assume strict mapping or normalize.
        // If resource is "admin/users", needed permission might be "system_users:read".

        let targetResource = resource;

        // Map frontend resources to backend resources
        // Note: This mapping ensures Refine resources (like "admin/users") align with backend RBAC resources ("system_users").
        // If you add new resources, update this map here.
        // TODO: Move to external config or inject via context in the future for flexibility.
        const resourceMap: Record<string, string> = {
            "admin/users": "system_users",
            "admin/tenants": "system_tenants",
            "users": "users",
            "tenants": "tenants",
        };

        if (resource && resourceMap[resource]) {
            targetResource = resourceMap[resource];
        }

        const requiredPermission = `${targetResource}:${requiredAction}`;

        // Also allow if specific permission exists (e.g. system_users:invite)
        // If action is custom, e.g. "invite", check "system_users:invite"
        if (action !== "list" && action !== "show" && action !== "create" && action !== "edit" && action !== "delete") {
            // Custom action (exact match)
            if (permissions.includes(`${targetResource}:${action}`)) {
                return { can: true };
            }
        }

        // Standard Check
        // Check exact match
        if (permissions.includes(requiredPermission)) {
            return { can: true };
        }

        // Check "manage" implies "read"? 
        // Usually "manage" implies everything.
        // If I require "read", but have "manage", I should typically allow.
        if (requiredAction === "read" && permissions.includes(`${targetResource}:manage`)) {
            return { can: true };
        }

        return {
            can: false,
            reason: `Missing permission: ${requiredPermission}`,
        };
    },
};
