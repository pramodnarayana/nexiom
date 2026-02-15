import { createContext, useContext } from 'react';
import type { AuthContextType } from './types';
import { createContextualCan } from '@casl/react';
import type { AppAccessControl } from './access-control';

export const AccessControlContext = createContext<AppAccessControl | undefined>(undefined);
export const Can = createContextualCan(AccessControlContext.Consumer as unknown as React.Consumer<AppAccessControl>);

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function useAuth() {
    const context = useContext(AuthContext);
    if (!context) {
        throw new Error("useAuth must be used within an AuthProvider");
    }
    return context;
}
