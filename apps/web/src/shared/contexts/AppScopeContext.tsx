import { createContext, useMemo, type ReactNode } from 'react';
import { RESOURCES, type ResourceType } from '@/shared/constants/resources';

/**
 * Application scope type - either 'system' (admin) or 'organization' (tenant)
 */
export type AppScope = 'system' | 'organization';

/**
 * Resource mappings for a specific scope
 */
export type ResourceMap = Readonly<Record<ResourceType, string>>;

/**
 * Context value containing scope and resource mappings
 */
export interface AppScopeContextValue {
    scope: AppScope;
    resources: ResourceMap;
}

/**
 * React context for application scope
 * @internal - Use via useAppScope hook instead
 */
// eslint-disable-next-line react-refresh/only-export-components
export const AppScopeContext = createContext<AppScopeContextValue | undefined>(undefined);

/**
 * Provider component that establishes the application scope context
 * 
 * Wraps route hierarchies to provide scope-aware resource resolution.
 * Use this at the route level to establish whether components are in
 * in 'system' (admin) or 'organization' (tenant) scope.
 * 
 * @example
 * <AppScopeProvider scope="system">
 *   <AdminRoutes />
 * </AppScopeProvider>
 */
export function AppScopeProvider({
    children,
    scope
}: Readonly<{
    children: ReactNode;
    scope: AppScope;
}>) {
    const value = useMemo<AppScopeContextValue>(() => {
        const resources = scope === 'system' ? RESOURCES.SYSTEM : RESOURCES.ORGANIZATION;
        return { scope, resources };
    }, [scope]);

    return (
        <AppScopeContext.Provider value={value}>
            {children}
        </AppScopeContext.Provider>
    );
}
