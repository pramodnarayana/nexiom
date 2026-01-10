import type { AuthProvider } from "@refinedev/core";
import { authClient } from "@/lib/auth-client";

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

        // Role Check: Only Admin allowed
        // Note: session.data.user.roles is an array (per our fix)
        // We need to cast it or check 'role' if typed loosely
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const user = session.data.user as any;
        const roles = Array.isArray(user.roles) ? user.roles : [user.role || 'user'];

        if (!roles.includes("admin")) {
            return {
                authenticated: false,
                redirectTo: "/dashboard", // Redirect non-admins to dashboard
                error: {
                    message: "Access Denied",
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
            };
        }
        return null;
    },
    onError: async (error: Error) => {
        console.error(error);
        return { error };
    },
};
