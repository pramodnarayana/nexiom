import { useState, useEffect, useCallback, useMemo, type ReactNode } from 'react';
import type { AuthContextType, AuthUser } from './types';
import { authClient } from '../auth-client';
import { AuthContext } from './context';

const API_URL = import.meta.env.VITE_API_URL;

/**
 * Context Provider for managing Authentication state.
 * Replaces the previous OIDC provider with a custom implementation
 * that corresponds to the internal Better Auth backend.
 * 
 * @param children - The child components that need access to auth context.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<AuthUser | null>(null);
    const [token, setToken] = useState<string | undefined>(undefined);
    const [isLoading, setIsLoading] = useState(true);

    // Init: Check localStorage and Backend Session (Better Auth)
    useEffect(() => {
        const initAuth = async () => {
            try {
                // 1. Check Server Session (Cookies) - Source of Truth
                const { data, error } = await authClient.getSession();

                if (data) {
                    // Standard getSession returns basic info. We MUST fetch enriched info (Organization, etc.)
                    // using our custom endpoint, as we removed customSession hook.
                    let enrichedData = null;
                    try {
                        const sessionRes = await fetch(`${API_URL}/auth/refresh-session`, {
                            method: 'POST',
                            headers: {
                                'Authorization': `Bearer ${data.session.token}` // Ensure Token is explicit if cookie fails
                            },
                            credentials: 'include',
                        });
                        if (sessionRes.ok) {
                            enrichedData = await sessionRes.json();
                        } else {
                            console.warn("AuthProvider: Enriched fetch failed", sessionRes.status);
                        }
                    } catch (err) {
                        console.error("Failed to fetch enriched session", err);
                    }

                    // Fallback to basic data if enriched fails, but DO NOT auto-provision based on incomplete data.
                    if (enrichedData) {
                        const sessionUser = enrichedData.user as unknown as AuthUser;

                        // AUTO-PROVISION CHECK
                        // FIX: Do not auto-provision if the user is a Platform Admin/User (they don't need a default tenant)
                        const isPlatformUser =
                            sessionUser.systemRole === 'platform_admin' ||
                            sessionUser.systemRole === 'platform_user';

                        if (!sessionUser.hasTenant && !sessionUser.organizationId && !isPlatformUser) {
                            if (!API_URL) {
                                console.error("VITE_API_URL is missing!");
                                return;
                            }
                            const res = await fetch(`${API_URL}/auth/provision-tenant`, {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/json',
                                    'Authorization': `Bearer ${data.session.token}`
                                },
                                credentials: 'include',
                            });

                            if (!res.ok) {
                                console.error("Provisioning Failed!", res.status);
                                hydrateUser(enrichedData);
                            } else {
                                // Retry Enriched Fetch
                                const retryRes = await fetch(`${API_URL}/auth/refresh-session`, {
                                    method: 'POST',
                                    headers: {
                                        'Authorization': `Bearer ${data.session.token}`
                                    },
                                    credentials: 'include',
                                });

                                if (retryRes.ok) {
                                    try {
                                        const refreshed = await retryRes.json();
                                        hydrateUser(refreshed);
                                    } catch (err) {
                                        console.warn("Retry refresh-session JSON parse failed:", err);
                                        hydrateUser(enrichedData);
                                    }
                                } else {
                                    console.warn("Retrying Enriched Fetch failed:", retryRes.status);
                                    // Fallback to initial enrichedData (which lacks tenant but is better than nothing)
                                    // or just data if enriched was null (though we are inside enrichedData check here)
                                    hydrateUser(enrichedData);
                                }
                            }
                        } else {
                            // Already has tenant
                            hydrateUser(enrichedData);
                        }
                    } else {
                        // Enriched fetch failed (e.g. network error, 401).
                        // Fallback to basic session data but SKIP auto-provisioning to avoid creating duplicate tenants.
                        // The user might see a degraded UI (no org context), but that's better than corrupting state.
                        console.warn("AuthProvider: Skipping auto-provisioning due to missing enriched data.");
                        hydrateUser(data);
                    }
                } else {
                    // Server says "No Session". Trust it.
                    console.warn("AuthProvider: No Session Found (data is null). Error:", error);
                    setToken(undefined);
                    setUser(null);
                }
            } catch (error) {
                console.error('Failed to fetch session', error);
            } finally {
                setIsLoading(false);
            }
        };

        const hydrateUser = (data: { user: unknown; session: { token: string } }) => {
            const apiUser = data.user as Record<string, unknown>;
            console.log("AuthProvider Hydrate:", JSON.stringify(apiUser, null, 2));

            // Better Auth returns 'roles' as an array OR 'role' as string. Normalize to array.
            let finalRoles: string[] = ['user'];
            if (Array.isArray(apiUser.roles)) {
                finalRoles = apiUser.roles as string[];
            } else if (typeof apiUser.role === 'string') {
                finalRoles = [apiUser.role];
            }

            const authUser: AuthUser = {
                id: String(apiUser.id),
                email: String(apiUser.email),
                name: typeof apiUser.name === 'string' ? apiUser.name : undefined,
                roles: finalRoles,
                organizationId: typeof apiUser.organizationId === 'string' ? apiUser.organizationId : undefined,
                organizationName: typeof apiUser.organizationName === 'string' ? apiUser.organizationName : undefined,
                hasTenant: !!apiUser.hasTenant,
                systemRole: typeof apiUser.systemRole === 'string' ? (apiUser.systemRole as 'platform_admin' | 'platform_user') : undefined
            };
            setToken(data.session.token);
            setUser(authUser);
        }

        initAuth();
    }, []);

    /**
     * Updates the local auth state upon successful login.
     * 
     * @param data - The login response containing accessToken and user object.
     */
    const login = useCallback((data: { accessToken: string; user: unknown }) => {
        const apiUser = data.user as Record<string, unknown>;
        setToken(data.accessToken);

        const fullName = typeof apiUser.name === 'string' ? apiUser.name :
            `${apiUser.firstName || ''} ${apiUser.lastName || ''}`.trim();

        // Handle both Singular ('role') and Plural ('roles') formats
        let finalRoles: string[] = ['user'];

        if (Array.isArray(apiUser.roles)) {
            finalRoles = apiUser.roles as string[];
        } else if (typeof apiUser.role === 'string') {
            finalRoles = [apiUser.role];
        }

        setUser({
            id: String(apiUser.id),
            email: String(apiUser.email),
            name: fullName,
            roles: finalRoles,
            organizationId: typeof apiUser.organizationId === 'string' ? apiUser.organizationId : undefined,
            organizationName: typeof apiUser.organizationName === 'string' ? apiUser.organizationName : undefined,
            hasTenant: !!apiUser.hasTenant,
            systemRole: typeof apiUser.systemRole === 'string' ? (apiUser.systemRole as 'platform_admin' | 'platform_user') : undefined
        });
    }, []);

    const logout = useCallback(async () => {
        try {
            console.log("Initiating logout...");
            await authClient.signOut();
            console.log("Logout successful from server");
        } catch (error) {
            console.error('Logout failed', error);
        }

        setToken(undefined);
        setUser(null);
        window.location.href = '/';
    }, []);

    const value: AuthContextType = useMemo(() => ({
        user,
        token,
        isAuthenticated: !!user,
        isLoading,
        login: async () => { },
        signup: async () => { },
        logout,
        setAuthState: login,
    }), [user, token, isLoading, logout, login]);

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
