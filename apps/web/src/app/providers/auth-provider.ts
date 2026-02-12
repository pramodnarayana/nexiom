import type { AuthProvider } from "@refinedev/core";
import { authClient } from "@/shared/lib/auth-client";

export const authProvider: AuthProvider = {
    login: async ({ email, password }: Record<string, string>) => {
        const { error } = await authClient.signIn.email({
            email,
            password,
        });

        if (error) {
            return {
                success: false,
                error: {
                    name: "LoginError",
                    message: error.message || "Invalid credentials",
                },
            };
        }

        return {
            success: true,
            redirectTo: "/admin",
        };
    },
    logout: async () => {
        await authClient.signOut();
        return {
            success: true,
            redirectTo: "/login",
        };
    },
    check: async () => {
        const session = await authClient.getSession();
        if (!session.data) {
            return {
                authenticated: false,
                redirectTo: "/login",
            };
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const user = session.data.user as any;
        const permissions = user.permissions || [];

        // STRICT RBAC:
        // We do not check for "admin" or "platform_admin" role strings anymore.
        // Access is granted if the user has ANY permissions assigned.
        // Platform Admins will inherently have '*' or specific permissions from the backend.
        if (permissions.length === 0) {
            return {
                authenticated: false,
                redirectTo: "/dashboard",
                error: {
                    message: "Access Denied. No adequate permissions.",
                    name: "Unauthorized"
                }
            }
        }

        return {
            authenticated: true,
        };
    },
    getIdentity: async () => {
        const { data } = await authClient.getSession();
        if (data?.user) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const user = data.user as any;
            return {
                id: user.id,
                name: user.name,
                avatar: user.image,
                roles: Array.isArray(user.roles) ? user.roles : (user.role ? [user.role] : []),
                permissions: user.permissions || [],
            };
        }
        return null;
    },
    getPermissions: async () => {
        try {
            // Fetch enriched user from backend /api/users/me endpoint
            // This includes permissions that are loaded by the backend
            const apiURL = import.meta.env.VITE_API_URL;
            if (!apiURL) {
                console.error('[AuthProvider] VITE_API_URL not defined');
                return [];
            }

            const response = await fetch(`${apiURL}/users/me`, {
                credentials: 'include', // Include cookies for session
            });

            if (!response.ok) {
                console.log('[AuthProvider] Failed to fetch /users/me:', response.status);
                return [];
            }

            const user = await response.json();
            console.log('[AuthProvider] Permissions loaded from /users/me:', user.permissions);
            return user.permissions || [];
        } catch (error) {
            console.error('[AuthProvider] Error fetching permissions:', error);
            return [];
        }
    },
    onError: async (error: Error) => {
        console.error(error);
        return { error };
    },
};
