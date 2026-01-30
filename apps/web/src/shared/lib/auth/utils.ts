

/**
 * Checks if a user has a specific permission.
 * Supports:
 * 1. Root Wildcard ('*')
 * 2. Exact Match ('resource:action')
 * 3. Resource Wildcard ('resource:*')
 * 4. Action Wildcard ('*:action')
 */
export function hasPermission(permissions: string[] | undefined, resource: string, action: string): boolean {
    if (!permissions || permissions.length === 0) return false;

    const requiredPermission = `${resource}:${action}`;
    const resourceWildcard = `${resource}:*`;
    const actionWildcard = `*:${action}`;

    return permissions.some(p =>
        p === '*' ||                 // 1. Super Admin
        p === requiredPermission ||  // 2. Exact Match
        p === resourceWildcard ||  // 3. Resource Wildcard
        p === actionWildcard         // 4. Action Wildcard
    );
}
