export interface AppUser {
    name?: string;
    email?: string;
    roles?: string[];
    organizationName?: string;
    permissions?: string[];
}

export interface AuthContextValue {
    user: AppUser | null;
    isAuthenticated: boolean;
    logout: () => void;
    isLoading: boolean;
}
