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
    const [theme, setTheme] = useState<string>(
        () => {
            try {
                return localStorage.getItem(storageKey) || defaultTheme;
            } catch {
                return defaultTheme;
            }
        }
    );

    const applyTheme = useCallback((currentThemeKey: string) => {
        const root = window.document.documentElement;
        // SAFEGUARD: Ensure theme exists, or fallback to default
        const currentTheme = themes[currentThemeKey] || themes[defaultTheme] || Object.values(themes)[0];

        if (!currentTheme) return;

        const isDark = root.classList.contains("dark");
        const cssVars = isDark ? currentTheme.cssVars.dark : currentTheme.cssVars.light;

        Object.entries(cssVars).forEach(([property, value]) => {
            root.style.setProperty(property, value);
        });
    }, [defaultTheme]);

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
        setTheme: (theme: string) => {
            setTheme(theme);
        },
        availableThemes: Object.values(themes),
    };

    return (
        <ThemeProviderContext.Provider {...props} value={value}>
            {children}
        </ThemeProviderContext.Provider>
    );
}
