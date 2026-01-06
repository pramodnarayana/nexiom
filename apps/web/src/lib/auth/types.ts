/**
 * Generic User Interface
 * This is what our application expects a User to look like.
 * It does NOT depend on Zitadel or Auth0.
 */
export interface AuthUser {
    id: string;
    email: string;
    name?: string;
    roles: string[];
    organizationId?: string;
    organizationName?: string;
    hasTenant?: boolean;
}

/**
 * The Contract for our Authentication System.
 * Any component (Reset Password, Login, Dashboard) will use THIS interface.
 */
export interface AuthContextType {
    user: AuthUser | null;
    isAuthenticated: boolean;
    isLoading: boolean;
    token?: string;

    // Actions
    login: () => void;
    signup: () => void;
    logout: () => void;
}
