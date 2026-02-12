import { useContext } from 'react';
import { AppScopeContext, type AppScopeContextValue, type AppScope } from './AppScopeContext';
import { type ResourceType } from '../constants/resources';

/**
 * Hook to access the current application scope and resources.
 * Must be used within an AppScopeProvider.
 * 
 * @throws Error if used outside AppScopeProvider
 * 
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { scope, resources } = useAppScope();
 *   return <div>Current scope: {scope}</div>;
 * }
 * ```
 */
export function useAppScope(): AppScopeContextValue {
    const context = useContext(AppScopeContext);
    if (!context) {
        throw new Error('useAppScope must be used within AppScopeProvider');
    }
    return context;
}

/**
 * Hook to get a scope-aware resource name.
 * Automatically resolves to the correct resource based on current scope.
 * 
 * @param type - Resource type (USERS, INVITATIONS, TENANTS)
 * @returns Scope-specific resource name
 * 
 * @example
 * ```tsx
 * function InviteDialog() {
 *   const invitationResource = useResourceName('INVITATIONS');
 *   // System scope: 'admin/invitations'
 *   // Organization scope: 'invitations'
 *   
 *   create({ resource: invitationResource, ... });
 * }
 * ```
 */
export function useResourceName(type: ResourceType): string {
    const { resources } = useAppScope();
    return resources[type];
}

/**
 * Hook to check if currently in system (platform admin) scope.
 * 
 * @returns true if in system scope, false if in organization scope
 * 
 * @example
 * ```tsx
 * function AdminFeature() {
 *   const isSystem = useIsSystemScope();
 *   if (!isSystem) return null;
 *   return <SystemOnlyFeature />;
 * }
 * ```
 */
export function useIsSystemScope(): boolean {
    const { scope } = useAppScope();
    return scope === 'system';
}

// Re-export types
export type { AppScope, AppScopeContextValue };
