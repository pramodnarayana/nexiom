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
interface UserWithPermissions {
    permissions?: string[];
}

/**
 * Check if user is a System Owner based on their permissions.
 * System Owners have admin-level permissions like admin_dashboard:view or system_*:read
 * 
 * @param permissions - Array of permission strings
 * @returns true if user has system owner permissions
 */
export function isSystemOwner(permissions?: string[]): boolean {
    return (
        hasPermission(permissions, 'admin_dashboard', 'view') ||
        hasPermission(permissions, 'system_users', 'read')
    );
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
