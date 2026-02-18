import { AppRoutes } from './constants';

/**
 * Checks if a user has a specific permission.
 * Supports:
 * 1. Root Wildcard ('*')
 * 2. Exact Match ('resource:action')
 * 3. Resource Wildcard ('resource:*')
 * 4. Action Wildcard ('*:action')
 */
export function hasPermission(
    permissions: string[] | undefined,
    resource: string,
    action: string
): boolean {
    if (!permissions || permissions.length === 0) return false;

    const requiredPermission = `${resource}:${action}`;
    const resourceWildcard = `${resource}:*`;
    const actionWildcard = `*:${action}`;

    return permissions.some(p =>
        p === '*' ||                 // 1. Super Admin
        p === requiredPermission ||  // 2. Exact Match
        p === resourceWildcard ||    // 3. Resource Wildcard
        p === actionWildcard         // 4. Action Wildcard
    );
}

/**
 * User type with permissions
 */
export interface UserWithPermissions {
    permissions?: string[];
}

/**
 * System owner permissions that grant admin-level access.
 * Users with any of these permissions are considered system owners.
 */
const SYSTEM_OWNER_PERMISSIONS = [
    'admin_dashboard:view',
    'system_users:read',
] as const;

/**
 * Check if user is a System Owner based on their permissions.
 * 
 * System Owners have specific admin-level permissions defined in SYSTEM_OWNER_PERMISSIONS.
 * This approach uses explicit permission checks rather than wildcard matching for better
 * security and maintainability.
 * 
 * @param permissions - Array of permission strings
 * @returns true if user has any system owner permission
 */
export function isSystemOwner(permissions?: string[]): boolean {
    if (!permissions) return false;

    return SYSTEM_OWNER_PERMISSIONS.some(perm => {
        const [resource, action] = perm.split(':');
        return hasPermission(permissions, resource, action);
    });
}

/**
 * Get the home path for a user based on their role/permissions.
 * System Owners are redirected to /admin, all others to /dashboard
 * 
 * @param user - User object with permissions
 * @returns Appropriate home path for the user
 * 
 * @example
 * ```typescript
 * const homePath = getHomePathForUser(user);
 * navigate(homePath);
 * ```
 */
export function getHomePathForUser(user: UserWithPermissions): string {
    if (isSystemOwner(user.permissions)) {
        return AppRoutes.ADMIN.ROOT;
    }
    return AppRoutes.TENANT.ROOT;
}


/**
 * Resource Normalization Map
 * Maps frontend resource paths (e.g. 'admin/users') to backend permission subjects (e.g. 'system_users').
 */
export const RESOURCE_MAP: Readonly<Record<string, string>> = {
    "admin/users": "system_users",
    "admin/tenants": "system_tenants",
};

/**
 * Normalizes a resource string to its permission subject.
 * Handles 'admin/' prefix removal and explicit mapping.
 * 
 * @param resource - The resource string (e.g. 'admin/users' or 'users')
 * @returns The normalized permission subject (e.g. 'system_users' or 'users')
 */
export function normalizeResource(resource: string): string {
    if (!resource) return "";

    // Strip leading/trailing slashes so '/admin/users' matches 'admin/users' in RESOURCE_MAP
    const trimmed = resource.replaceAll(/(^\/+)|(\/+$)/g, "");

    // 1. Explicit Mapping
    if (trimmed in RESOURCE_MAP) {
        return RESOURCE_MAP[trimmed];
    }

    // 2. Prefix Stripping (admin/foo -> foo) - Fallback for unmapped admin resources
    if (trimmed.startsWith("admin/")) {
        return trimmed.replace(/^admin\//, "");
    }

    return trimmed;
}
