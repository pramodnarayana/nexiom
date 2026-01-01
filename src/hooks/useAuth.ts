import { useAuth as useOidcAuth } from "react-oidc-context";
import type { AuthContextType, AuthUser } from "../lib/auth/types";

// This is the "Adapter". It translates Zitadel's complex object
// into our simple 'AuthContextType'.

export function useAuth(): AuthContextType {
    const auth = useOidcAuth();

    const user: AuthUser | null = auth.user?.profile ? {
        id: auth.user.profile.sub || "",
        email: auth.user.profile.email || "",
        name: auth.user.profile.name || "",
        // We will configure Zitadel to send roles in this claim, or map it from groups
        roles: (auth.user.profile['urn:zitadel:iam:org:project:roles'] as string[]) || []
    } : null;

    return {
        user,
        isAuthenticated: auth.isAuthenticated,
        isLoading: auth.isLoading,
        login: (mode = 'login') => {
            // OIDC Standard: prompt='create' asks the IDP to show the registration page
            const args = mode === 'signup' ? { prompt: 'create' } : {};
            auth.signinRedirect(args);
        },
        logout: () => auth.signoutRedirect(),
    };
}
