import type { AccessControlProvider, CanParams, CanReturnType } from "@refinedev/core";
import { authProvider } from "./auth-provider";
import { hasPermission, normalizeResource } from "@/shared/lib/auth/utils";

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
        const targetResource = normalizeResource(resource ?? "");

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
