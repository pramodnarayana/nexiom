
import { useState, useEffect, useCallback, useMemo, useRef, type ReactNode } from 'react';
import type { AuthContextType, AuthUser } from './types';
import { authClient } from '../auth-client';
import { apiClient } from '../api-client';
import { AuthContext } from './context';

// Constants
const MAX_RETRIES = 3;

import type { Tenant } from '@nexiom/identity';

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
    const provisionAttemptsRef = useRef(0);

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
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const { data, error: _error } = await authClient.getSession();

            if (data) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const apiUser = data.user as any;

                // 2. Check for Organization Context in Session (Fast Path)
                if (apiUser.organizationId) {
                    hydrateUser(data);
                    setIsLoading(false);
                } else {
                    // 3. Explicitly Fetch Tenants
                    let tenantsFound = false;
                    let fetchSucceeded = false;
                    try {
                        const res = await apiClient.get<Tenant[]>('/tenants');
                        fetchSucceeded = true;
                        const tenants = res.data;

                        if (tenants.length > 0) {
                            // Found tenants! Pick the first one (or recently active if we tracked it)
                            const sorted = [...tenants].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
                            const activeTenant = sorted[0];

                            hydrateUser(data, activeTenant);
                            setIsLoading(false);
                            tenantsFound = true;
                            provisionAttemptsRef.current = 0; // Reset on success
                            return;
                        }
                    } catch (error_) {
                        // Don't fail completely, try provisioning if really needed
                        // Log error but continue to allow fallback if logic permits
                        console.warn("[AuthProvider] Failed to fetch tenants:", error_);
                    }

                    // 4. Fallback: Auto-Provisioning (Only if NO tenants found AND fetch succeeded)
                    // If fetch failed, we shouldn't auto-provision because we don't know if tenants exist.
                    if (!tenantsFound && fetchSucceeded && provisionAttemptsRef.current < MAX_RETRIES) {
                        provisionAttemptsRef.current += 1;
                        try {
                            await apiClient.post('/auth/provision-tenant');

                            // Immediately re-check session after provisioning success
                            // This avoids recursive call issues in useCallback
                            const { data: newData } = await authClient.getSession();
                            if (newData) {
                                // Try fetching tenants one last time
                                try {
                                    const res = await apiClient.get<Tenant[]>('/tenants');
                                    if (res.data.length > 0) {
                                        // Sort by createdAt (newest first) to match tenant selection logic
                                        // Handle parsing date string from API vs Date object in type
                                        const sorted = [...res.data].sort((a, b) =>
                                            new Date(String(b.createdAt)).getTime() - new Date(String(a.createdAt)).getTime()
                                        ); hydrateUser(newData, sorted[0]);
                                        setIsLoading(false);
                                        provisionAttemptsRef.current = 0; // Reset on success
                                        return;
                                    }
                                } catch (e) {
                                    console.error('Failed to refetch tenants after provisioning:', e);
                                }

                                // Or at least hydrate what we have
                                hydrateUser(newData);
                                setIsLoading(false);
                                provisionAttemptsRef.current = 0; // Reset on success
                                return;
                            }
                        } catch (provError) {
                            console.error("[AuthProvider] Auto-Provisioning Failed:", provError);
                        }
                    }

                    // If exhausted retries or provisioning failed:
                    hydrateUser(data);
                    setIsLoading(false);
                }
            } else {
                setToken(undefined);
                setUser(null);
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
        const fullName = typeof apiUser.name === 'string' ? apiUser.name : `${apiUser.firstName || ''} ${apiUser.lastName || ''}`.trim();
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
        provisionAttemptsRef.current = 0; // Reset on logout
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

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
