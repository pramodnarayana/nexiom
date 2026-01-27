
/**
 * Checks if a user has sufficient permissions to access the admin area.
 * 
 * Rules:
 * 1. Default: user.permissions includes '*' (Super Admin).
 * 2. System Level: user.permissions includes 'tenants:manage', 'tenants:read', or 'users:manage'.
 * 3. Namespace: user.permissions starts with 'system_' or 'admin:'.
 * 
 * @param permissions List of permission strings.
 * @returns boolean
 */
export function hasAdminAccess(permissions?: string[]): boolean {
    if (!permissions || permissions.length === 0) return false;

    // Super Admin
    if (permissions.includes('*')) return true;

    // Explicit System Permissions
    const systemPermissions = ['tenants:manage', 'tenants:read', 'users:manage'];
    if (permissions.some(p => systemPermissions.includes(p))) return true;

    // Check for Namespaced System Permissions (e.g. system_users:read, admin:dashboard)
    // We check the resource part of the permission string "resource:action" (or just verify prefix)
    return permissions.some(p => {
        return p.startsWith('system_') || p.startsWith('admin:');
    });
}
