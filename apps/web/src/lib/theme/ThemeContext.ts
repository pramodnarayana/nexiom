import { createContext } from "react";
import { type Theme } from "./themes";

export type ThemeProviderState = {
    theme: string;
    setTheme: (theme: string) => void;
    availableThemes: Theme[];
};

export const ThemeProviderContext = createContext<ThemeProviderState | undefined>(undefined);
