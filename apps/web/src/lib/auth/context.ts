import { createContext, useContext } from 'react';
import type { AuthContextType } from './types';

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function useAuthContext() {
    return useContext(AuthContext);
}
