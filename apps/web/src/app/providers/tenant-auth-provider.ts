import type { AuthProvider } from "@refinedev/core";
import { authClient } from "@/shared/lib/auth-client";

export const tenantAuthProvider: AuthProvider = {
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
            redirectTo: "/dashboard",
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

        // For Tenant Dashboard, any authenticated user is allowed.
        // We might want to check if they belong to an organization, but for now auth is enough.

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
                organizationId: user.organizationId, // Useful for Tenant Context
            };
        }
        return null;
    },
    onError: async (error: Error) => {
        console.error(error);
        return { error };
    },
};
