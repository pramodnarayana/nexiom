import { useState, useEffect, type ReactNode } from 'react';
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
                const { data } = await authClient.getSession();

                if (data) {
                    // Standard getSession returns basic info. We MUST fetch enriched info (Organization, etc.)
                    // using our custom endpoint, as we removed customSession hook.
                    let enrichedData = null;
                    try {
                        const sessionRes = await fetch(`${API_URL}/auth/refresh-session`, {
                            method: 'POST',
                            headers: {
                                'Authorization': `Bearer ${data.session.token}`
                            },
                            credentials: 'include',
                        });
                        if (sessionRes.ok) {
                            enrichedData = await sessionRes.json();
                        }
                    } catch (err) {
                        console.error("Failed to fetch enriched session", err);
                    }

                    // Fallback to basic data if enriched fails (shouldn't happen if session is valid)
                    const userToCheck = enrichedData ? enrichedData.user : data.user;
                    const sessionUser = userToCheck as unknown as AuthUser;

                    // AUTO-PROVISION CHECK
                    if (!sessionUser.hasTenant && !sessionUser.organizationId) {
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
                            if (enrichedData) hydrateUser(enrichedData);
                            else hydrateUser(data);
                        } else {
                            // Retry Enriched Fetch
                            const retryRes = await fetch(`${API_URL}/auth/refresh-session`, {
                                method: 'POST',
                                headers: {
                                    'Authorization': `Bearer ${data.session.token}`
                                },
                                credentials: 'include',
                            });
                            const refreshed = await retryRes.json();
                            hydrateUser(refreshed);
                        }
                    } else {
                        // Already has tenant
                        if (enrichedData) hydrateUser(enrichedData);
                        else hydrateUser(data);
                    }
                } else {
                    // Server says "No Session". Trust it.
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
            const rawUser = data.user as Record<string, unknown>;
            const authUser: AuthUser = {
                id: String(rawUser.id),
                email: String(rawUser.email),
                name: typeof rawUser.name === 'string' ? rawUser.name : undefined,
                roles: Array.isArray(rawUser.roles) ? rawUser.roles as string[] : ['admin'],
                organizationId: typeof rawUser.organizationId === 'string' ? rawUser.organizationId : undefined,
                organizationName: typeof rawUser.organizationName === 'string' ? rawUser.organizationName : undefined,
                hasTenant: !!rawUser.hasTenant
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
    const login = (data: { accessToken: string; user: unknown }) => {
        const rawUser = data.user as Record<string, unknown>;
        setToken(data.accessToken);

        const fullName = typeof rawUser.name === 'string' ? rawUser.name :
            `${rawUser.firstName || ''} ${rawUser.lastName || ''}`.trim();

        const roleId = typeof rawUser.roleId === 'string' ? rawUser.roleId : 'user';

        setUser({
            id: String(rawUser.id),
            email: String(rawUser.email),
            name: fullName,
            roles: [roleId],
            organizationId: typeof rawUser.organizationId === 'string' ? rawUser.organizationId : undefined,
            organizationName: typeof rawUser.organizationName === 'string' ? rawUser.organizationName : undefined,
            hasTenant: !!rawUser.hasTenant
        });
    };

    /**
     * Clears the auth state.
     */
    const logout = async () => {
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
    };

    // Adapter matching AuthContextType
    const value: AuthContextType = {
        user,
        token,
        isAuthenticated: !!user,
        isLoading,
        login: async () => { },
        signup: async () => { },
        logout,
        setAuthState: login,
    };

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
