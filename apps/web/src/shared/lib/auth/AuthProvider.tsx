
import { useState, useEffect, useCallback, useMemo, type ReactNode } from 'react';
import type { AuthContextType, AuthUser } from './types';
import { authClient } from '../auth-client';
import { apiClient } from '../api-client';
import { AuthContext, AccessControlContext } from './context';
import { defineAccessControlFor } from './access-control';

interface Tenant {
    id: string;
    name: string;
    slug: string;
    logo?: string | null;
    status: "active" | "archived" | "suspended";
    createdAt: Date;
    updatedAt?: Date;
    metadata?: Record<string, unknown>;
    isSystem: boolean;
}

/**
 * Context Provider for managing Authentication state.
 * Replaces the previous OIDC provider with a custom implementation
 * that corresponds to the internal Better Auth backend.
 * 
 * Includes Enterprise-Grade fallback and provisioning logic.
 */
export function AuthProvider({ children }: Readonly<{ children: ReactNode }>) {
    const [user, setUser] = useState<AuthUser | null>(null);
    const [token, setToken] = useState<string | undefined>(undefined);
    const [isLoading, setIsLoading] = useState(true);


    // Debug Lifecycle - Cleaned up

    const hydrateUser = useCallback((data: { user: unknown; session: { token: string } }, orgContext?: Tenant) => {
        const apiUser = data.user as Record<string, unknown>;

        // Better Auth returns 'roles' as an array OR 'role' as string. Normalize to array.
        let finalRoles: string[] = ['user'];
        if (Array.isArray(apiUser.roles)) {
            finalRoles = apiUser.roles as string[];
        } else if (typeof apiUser.role === 'string') {
            finalRoles = [apiUser.role];
        }

        // Use Explicit Org Context if provided, otherwise fallback to session
        const orgId = orgContext?.id || (typeof apiUser.organizationId === 'string' ? apiUser.organizationId : undefined);
        const orgName = orgContext?.name || (typeof apiUser.organizationName === 'string' ? apiUser.organizationName : undefined);

        const authUser: AuthUser = {
            id: String(apiUser.id),
            email: String(apiUser.email),
            name: typeof apiUser.name === 'string' ? apiUser.name : undefined,
            roles: finalRoles,
            organizationName: orgName,
            organizationId: orgId,
            hasTenant: !!orgId || !!apiUser.hasTenant,
            permissions: Array.isArray(apiUser.permissions) ? (apiUser.permissions as string[]) : []
        };
        setToken(data.session.token);
        setUser(authUser);
    }, []);

    const refreshSession = useCallback(async (shouldSetLoading = true) => {
        // Keep loading true during retries
        if (shouldSetLoading) setIsLoading(true);

        try {
            // 1. Check Server Session (Cookies) - Source of Truth
            // Renaming _error to sessionError to check status
            console.log('[AuthProvider] Fetching session...');
            const { data, error: sessionError } = await authClient.getSession();
            console.log('[AuthProvider] Session result:', { data, sessionError });


            if (data) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                let apiUser = data.user as any;

                // CRITICAL FIX: Always fetch full profile to ensure permissions are present
                // This bypasses Better-Auth client stripping and ensures we have the DB state
                // We let this throw to safe-guard against partial sessions
                // Attempt to fetch full profile, but fall back to session data on non-auth errors
                try {
                    const { data: fullUser } = await apiClient.get('/users/me');
                    apiUser = { ...apiUser, ...fullUser };
                    data.user = apiUser;
                } catch (profileError) {
                    const errorMessage = profileError instanceof Error ? profileError.message : 'Unknown error';
                    const status = (profileError as { response?: { status?: number } })?.response?.status;
                    if (status === 401) {
                        throw profileError; // Re-throw auth errors
                    }
                    if (process.env.NODE_ENV === 'development') {
                        console.warn('[AuthProvider] Failed to fetch full profile, using session data:', profileError);
                    } else {
                        console.warn('[AuthProvider] Failed to fetch full profile, using session data:', errorMessage);
                    }
                    // Continue with partial session data rather than failing entirely
                }

                // 2. Check for Organization Context in Session (Fast Path)
                if (apiUser.organizationId) {
                    // We already have the full user, just hydrate
                    hydrateUser(data);
                    setIsLoading(false);
                } else {
                    // 3. Explicitly Fetch Tenants
                    try {
                        const res = await apiClient.get<Tenant[]>('/tenants');

                        const tenants = res.data ?? [];
                        if (tenants.length > 0) {
                            // Find most recently created tenant
                            const sorted = [...tenants].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
                            const activeTenant = sorted[0];

                            hydrateUser(data, activeTenant);
                            setIsLoading(false);
                            return;
                        } else {
                            // No tenants found - fallback
                            console.warn('[AuthProvider] No tenants found, hydrating with base user');
                            hydrateUser(data);
                            setIsLoading(false);
                        }
                    } catch (error_) {
                        console.warn("[AuthProvider] Failed to fetch tenants:", error_);
                        // Fallback on error
                        hydrateUser(data);
                        setIsLoading(false);
                    }
                }
            } else {
                // No Data from Session -> Valid Logout/Guest State
                if (sessionError) {
                    if (sessionError.status === 401) {
                        // Valid 401
                        setToken(undefined);
                        setUser(null);
                    } else {
                        console.warn("[AuthProvider] Session error (not 401):", sessionError);
                        // Keep existing state for non-401 errors (network issues, etc.)
                    }
                } else {
                    // No error but no data - genuine unauthenticated state
                    setToken(undefined);
                    setUser(null);
                }
                setIsLoading(false);
            }

        } catch (err) {
            console.error("[AuthProvider] refreshSession Failure", err);

            // Only clear auth state on explicit Unauthorized errors
            // Check Axios error format first, then fall back to generic error formats
            const errorStatus = (err as { response?: { status?: number } })?.response?.status ||
                (err as { status?: number; statusCode?: number })?.status ||
                (err as { status?: number; statusCode?: number })?.statusCode;
            if (errorStatus === 401) {
                setToken(undefined);
                setUser(null);
            }
            // For other errors (network, timeout, 500) -> Keep existing state (optimistic)
            setIsLoading(false);
        }
    }, [hydrateUser]);

    // Init
    useEffect(() => {
        // Defer refreshSession to next tick to avoid Strict Mode double-invoke issues
        // and ensure proper timing with hydration cycle.
        const timer = setTimeout(() => {
            void refreshSession(false);
        }, 0);
        return () => clearTimeout(timer);
    }, [refreshSession]);

    const login = useCallback(async (data: { accessToken: string; user: unknown }) => {
        // On Login, we also want to ensure we have context.
        const apiUser = data.user as Record<string, unknown>;
        setToken(data.accessToken);

        // ... (Basic hydration) ...
        const firstName = typeof apiUser.firstName === 'string' ? apiUser.firstName : '';
        const lastName = typeof apiUser.lastName === 'string' ? apiUser.lastName : '';
        const fullName = typeof apiUser.name === 'string' ? apiUser.name : `${firstName} ${lastName}`.trim();
        setUser({
            id: String(apiUser.id),
            email: String(apiUser.email),
            name: fullName,
            roles: ['user'],
            organizationId: undefined,
            organizationName: undefined,
            hasTenant: false,
            permissions: []
        });

        // Trigger full refresh to get org context and await it
        await refreshSession();

    }, [refreshSession]);

    const logout = useCallback(async () => {
        try {
            await authClient.signOut();
        } catch (error) {
            console.error('Logout failed', error);
        }
        setToken(undefined);
        setUser(null);
        globalThis.location.href = '/';
    }, []);

    const value: AuthContextType = useMemo(() => ({
        user,
        token,
        isAuthenticated: !!user,
        isLoading,
        login, // Updated to use refresh
        signup: async () => { },
        logout,
        setAuthState: login,
        refreshSession: async () => { await refreshSession(); },
    }), [user, token, isLoading, logout, login, refreshSession]);

    const accessControl = useMemo(() => {
        return defineAccessControlFor({ permissions: user?.permissions || [] });
    }, [user?.permissions]);

    return (
        <AuthContext.Provider value={value}>
            <AccessControlContext.Provider value={accessControl}>
                {children}
            </AccessControlContext.Provider>
        </AuthContext.Provider>
    );
}
