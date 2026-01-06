import { createContext, useState, useEffect, useContext, type ReactNode } from 'react';
import type { AuthContextType, AuthUser } from './types';
import { authClient } from '../auth-client';

const AuthContext = createContext<AuthContextType | undefined>(undefined);

/**
 * Context Provider for managing Authentication state.
 * Replaces the previous OIDC provider with a custom implementation
 * that corresponds to the internal Lucia Auth backend.
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
                // 1. Check Server Session (Cookies) - Source of Truth
                const { data } = await authClient.getSession();

                if (data) {
                    const sessionUser = data.user as any;

                    // AUTO-PROVISION CHECK: If user has no tenant (or undefined), create one automatically
                    // Also check organizationId to be sure
                    if (!sessionUser.hasTenant && !sessionUser.organizationId) {
                        const API_URL = import.meta.env.VITE_API_URL;
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
                        } else {
                            // FORCE REFRESH: Use RAW CUSTOM ENDPOINT (Bypasses library hooks)
                            const sessionRes = await fetch(`${API_URL}/auth/refresh-session`, {
                                method: 'POST',
                                headers: {
                                    'Authorization': `Bearer ${data.session.token}`
                                },
                                credentials: 'include'
                            });
                            const refreshed = await sessionRes.json();

                            if (refreshed && refreshed.user) {
                                hydrateUser(refreshed);
                            } else {
                                hydrateUser(data);
                            }
                        }
                    } else {
                        hydrateUser(data);
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

        const hydrateUser = (data: any) => {
            const authUser = {
                ...data.user,
                name: data.user.name,
                roles: ['admin'], // Defaulting to admin
                organizationId: (data.user as any).organizationId,
                organizationName: (data.user as any).organizationName
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
    const login = (data: any) => {
        // data = { accessToken, user, ... }
        setToken(data.accessToken);
        setUser({
            ...data.user,
            name: `${data.user.firstName} ${data.user.lastName}`,
            roles: [data.user.roleId]
        });
    };

    /**
     * Clears the auth state.
     * Redirects the user to the home page.
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
        login: async () => { }, // Not used directly by UI usually, UI calls API then local login
        signup: async () => { },
        logout,
        // Helper to set state from outside
        setAuthState: login,
    } as any;

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/**
 * Hook to consume the AuthContext.
 * Use this to access the current user, token, and auth methods.
 */
export function useAuthContext() {
    return useContext(AuthContext);
}
