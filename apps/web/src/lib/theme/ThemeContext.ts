import { createContext } from "react";
import { type Theme } from "./themes";

export type ThemeProviderState = {
    theme: string;
    setTheme: (theme: string) => void;
    availableThemes: Theme[];
};

export const initialState: ThemeProviderState = {
    theme: "bold-tech",
    setTheme: () => null,
    availableThemes: [],
};

export const ThemeProviderContext = createContext<ThemeProviderState>(initialState);
