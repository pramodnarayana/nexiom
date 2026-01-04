import { useAuth as useOidcAuth } from "react-oidc-context";
import type { AuthContextType, AuthUser } from "../lib/auth/types";

// This is the "Adapter". It translates Zitadel's complex object
// into our simple 'AuthContextType'.

export function useAuth(): AuthContextType {
    const auth = useOidcAuth();

    // DEBUG: Log the full profile to see what Zitadel sends
    if (auth.user) {
        console.log("DEBUG: Zitadel OIDC Profile:", auth.user.profile);
    }

    const user: AuthUser | null = auth.user?.profile ? {
        id: auth.user.profile.sub || "",
        email: auth.user.profile.email || "",
        // Fallback: name -> given_name+family_name -> preferred_username
        name: auth.user.profile.name ||
            (auth.user.profile.given_name ? `${auth.user.profile.given_name} ${auth.user.profile.family_name || ''}` : "").trim() ||
            auth.user.profile.preferred_username || "",
        // We will configure Zitadel to send roles in this claim, or map it from groups
        roles: (auth.user.profile['urn:zitadel:iam:org:project:roles'] as string[]) || []
    } : null;

    return {
        user,
        isAuthenticated: auth.isAuthenticated,
        isLoading: auth.isLoading,
        login: () => auth.signinRedirect(),
        signup: () => auth.signinRedirect({ prompt: 'create' }),
        logout: () => auth.signoutRedirect(),
    };
}
