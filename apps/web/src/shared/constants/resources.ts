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
 * Type aliases for future use in type-safe resource references.
 * 
 * These types are intentionally defined but currently unused. They exist for:
 * - Future type-safe permission checks (ensuring valid resource names)
 * - IDE autocomplete support for resource strings
 * - Future refactoring to make resource references more explicit
 * - Forward compatibility as the codebase evolves
 * 
 * While currently unused, they provide type safety for anyone who wants to
 * explicitly type resource strings in their code.
 */
export type SystemResource = typeof RESOURCES.SYSTEM[keyof typeof RESOURCES.SYSTEM];
export type OrganizationResource = typeof RESOURCES.ORGANIZATION[keyof typeof RESOURCES.ORGANIZATION];
export type ResourceName = SystemResource | OrganizationResource;

/**
 * Resource types that exist in both scopes.
 * This type represents the keys (USERS, INVITATIONS, TENANTS) rather than the values.
 */
export type ResourceType = keyof typeof RESOURCES.SYSTEM; // 'USERS' | 'INVITATIONS' | 'TENANTS'

/**
 * Compile-time assertion that SYSTEM and ORGANIZATION have matching keys.
 * This prevents accidental drift between the two resource maps.
 * 
 * If keys don't match, TypeScript will error at compile time with:
 * "Type 'false' is not assignable to type 'true'"
 */
type AssertKeysMatch<T, U> =
    keyof T extends keyof U
    ? keyof U extends keyof T
    ? true
    : false
    : false;

// This will cause a compile error if SYSTEM and ORGANIZATION keys don't match
const _assertResourceKeysMatch: AssertKeysMatch<
    typeof RESOURCES.SYSTEM,
    typeof RESOURCES.ORGANIZATION
> = true;

// Prevent unused variable warning
export { _assertResourceKeysMatch as __resourceKeyGuard };
