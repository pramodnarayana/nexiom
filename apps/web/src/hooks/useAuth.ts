import { useAuthContext } from "../lib/auth/AuthProvider";
import type { AuthContextType } from "../lib/auth/types";

export function useAuth(): AuthContextType {
    const context = useAuthContext();
    if (context === undefined) {
        throw new Error("useAuth must be used within an AuthProvider");
    }
    return context;
}
