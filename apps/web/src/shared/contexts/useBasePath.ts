import { useAppScope } from '@/shared/contexts/useAppScope';
import { type ResourceType, RESOURCES } from '@/shared/constants/resources';

/**
 * Derive base resource names from RESOURCES constant.
 * Extracts the base name (e.g., 'users' from 'admin/users' or 'users').
 * Module-scoped to avoid re-creation on every render.
 */
const RESOURCE_BASE_NAMES: Record<ResourceType, string> = {
    USERS: RESOURCES.ORGANIZATION.USERS,           // 'users'
    INVITATIONS: RESOURCES.ORGANIZATION.INVITATIONS, // 'invitations'
    TENANTS: RESOURCES.ORGANIZATION.TENANTS,       // 'tenants'
} as const;

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

    // Derive path from single source of truth (RESOURCES)
    const baseName = RESOURCE_BASE_NAMES[resourceType];
    return scope === 'system' ? `/admin/${baseName}` : `/dashboard/${baseName}`;
}
