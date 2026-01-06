/**
 * Generic User Interface
 * This is what our application expects a User to look like.
 * It relies on our internal auth system.
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

    // Helper to set state from outside
    setAuthState: (data: { accessToken: string; user: any }) => void;
}
