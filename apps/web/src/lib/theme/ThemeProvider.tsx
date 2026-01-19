import React, { useCallback, useEffect, useState } from "react";
import { themes } from "./themes";
import { ThemeProviderContext } from "./ThemeContext";

type ThemeProviderProps = {
    children: React.ReactNode;
    defaultTheme?: string;
    storageKey?: string;
};

export function ThemeProvider({
    children,
    defaultTheme = "violet-bloom",
    storageKey = "vite-ui-theme-preset",
    ...props
}: ThemeProviderProps) {
    // Helper to get a valid theme key
    const getValidTheme = useCallback((key: string | undefined | null) => {
        if (key && themes[key]) {
            return key;
        }
        if (defaultTheme && themes[defaultTheme]) {
            return defaultTheme;
        }
        return Object.keys(themes)[0];
    }, [defaultTheme]);

    const [theme, setThemeState] = useState<string>(
        () => {
            try {
                const stored = localStorage.getItem(storageKey);
                return getValidTheme(stored);
            } catch {
                return defaultTheme;
            }
        }
    );

    const applyTheme = useCallback((currentThemeKey: string) => {
        const root = window.document.documentElement;
        // Strict Validation: Ensure theme exists in map
        const validKey = getValidTheme(currentThemeKey);
        const currentTheme = themes[validKey];

        if (!currentTheme) return; // Should technically never happen due to getValidTheme

        const isDark = root.classList.contains("dark");
        const cssVars = isDark ? currentTheme.cssVars.dark : currentTheme.cssVars.light;

        Object.entries(cssVars).forEach(([property, value]) => {
            root.style.setProperty(property, value);
        });
    }, [getValidTheme]);

    const setTheme = useCallback((newTheme: string) => {
        const validTheme = getValidTheme(newTheme);
        setThemeState(validTheme);
    }, [getValidTheme]);

    useEffect(() => {
        applyTheme(theme);
        try {
            localStorage.setItem(storageKey, theme);
        } catch {
            // Ignore storage errors
        }
    }, [theme, storageKey, applyTheme]);

    // Listen for dark mode class changes (if managed by another provider like next-themes/shadcn's theme-provider)
    useEffect(() => {
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (
                    mutation.type === "attributes" &&
                    mutation.attributeName === "class"
                ) {
                    applyTheme(theme);
                }
            });
        });

        observer.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ["class"],
        });

        return () => observer.disconnect();
    }, [theme, applyTheme]);

    const value = {
        theme,
        setTheme,
        availableThemes: Object.values(themes),
    };

    return (
        <ThemeProviderContext.Provider {...props} value={value}>
            {children}
        </ThemeProviderContext.Provider>
    );
}
