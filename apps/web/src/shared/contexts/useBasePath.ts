import { useAppScope } from '@/shared/contexts/useAppScope';
import { type ResourceType, RESOURCES } from '@/shared/constants/resources';

/**
 * Custom hook to get the base path for a resource based on the current scope.
 * 
 * Paths are derived from RESOURCES constant ensuring single source of truth.
 * Module-scoped constants avoid re-creation on every render.
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

    return scope === 'system'
        ? `/${RESOURCES.SYSTEM[resourceType]}`
        : `/dashboard/${RESOURCES.ORGANIZATION[resourceType]}`;
}
