import { useAppScope } from '@/shared/contexts/useAppScope';
import { type ResourceType } from '@/shared/constants/resources';

/**
 * Custom hook to get the base path for a resource based on the current scope.
 * 
 * Eliminates duplication of path derivation logic across components.
 * 
 * @param resourceType - The type of resource (e.g., 'USERS', 'TENANTS')
 * @returns The base path for the resource (e.g., '/admin/users' or '/dashboard/users')
 * 
 * @example
 * ```tsx
 * const basePath = useBasePath('USERS');
 * // Returns '/admin/users' in system scope
 * // Returns '/dashboard/users' in organization scope
 * ```
 */
export function useBasePath(resourceType: ResourceType): string {
    const { scope } = useAppScope();

    const resourcePaths: Record<ResourceType, { admin: string; tenant: string }> = {
        USERS: { admin: '/admin/users', tenant: '/dashboard/users' },
        INVITATIONS: { admin: '/admin/invitations', tenant: '/dashboard/invitations' },
        TENANTS: { admin: '/admin/tenants', tenant: '/dashboard/tenants' },
    };

    const paths = resourcePaths[resourceType];
    return scope === 'system' ? paths.admin : paths.tenant;
}
