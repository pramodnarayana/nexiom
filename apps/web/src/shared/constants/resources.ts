/**
 * Single source of truth for all resource names in the application.
 * 
 * Resources are organized by scope:
 * - SYSTEM: Platform admin resources (accessed via /admin routes)
 * - ORGANIZATION: Tenant admin resources (accessed via /dashboard routes)
 * 
 * @example
 * ```ts
 * import { RESOURCES } from '@/shared/constants/resources';
 * 
 * // Type-safe resource access
 * const resource = RESOURCES.SYSTEM.USERS; // 'admin/users'
 * ```
 */
export const RESOURCES = {
    SYSTEM: {
        USERS: 'admin/users',
        INVITATIONS: 'admin/invitations',
        TENANTS: 'admin/tenants',
    },
    ORGANIZATION: {
        USERS: 'users',
        INVITATIONS: 'invitations',
        TENANTS: 'tenants',
    },
} as const;

/**
 * Type helpers for resource names
 */
export type SystemResource = typeof RESOURCES.SYSTEM[keyof typeof RESOURCES.SYSTEM];
export type OrganizationResource = typeof RESOURCES.ORGANIZATION[keyof typeof RESOURCES.ORGANIZATION];
export type ResourceName = SystemResource | OrganizationResource;

/**
 * Resource types that exist in both scopes
 */
export type ResourceType = keyof typeof RESOURCES.SYSTEM; // 'USERS' | 'INVITATIONS' | 'TENANTS'
