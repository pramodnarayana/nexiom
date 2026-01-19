import React, { useEffect, useState } from "react";
import { themes } from "./themes";
import { ThemeProviderContext } from "./ThemeContext";

type ThemeProviderProps = {
    children: React.ReactNode;
    defaultTheme?: string;
    storageKey?: string;
};

export function ThemeProvider({
    children,
    defaultTheme = "bold-tech",
    storageKey = "vite-ui-theme-preset",
    ...props
}: ThemeProviderProps) {
    const [theme, setTheme] = useState<string>(
        () => localStorage.getItem(storageKey) || defaultTheme
    );

    useEffect(() => {
        const root = window.document.documentElement;
        // SAFEGUARD: Ensure theme exists, or fallback to default
        const currentTheme = themes[theme] || themes[defaultTheme] || Object.values(themes)[0];

        if (!currentTheme) return; // Should never happen with fallback

        const isDark = root.classList.contains("dark");

        const cssVars = isDark ? currentTheme.cssVars.dark : currentTheme.cssVars.light;

        Object.entries(cssVars).forEach(([property, value]) => {
            root.style.setProperty(property, value);
        });

        localStorage.setItem(storageKey, theme);
    }, [theme, storageKey, defaultTheme]);

    // Listen for dark mode class changes (if managed by another provider like next-themes/shadcn's theme-provider)
    useEffect(() => {
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (
                    mutation.type === "attributes" &&
                    mutation.attributeName === "class"
                ) {
                    // Re-apply variables when class changes (light/dark toggle)
                    const root = window.document.documentElement;
                    const currentTheme = themes[theme] || themes[defaultTheme] || Object.values(themes)[0];

                    if (!currentTheme) return;

                    const isDark = root.classList.contains("dark");
                    const cssVars = isDark ? currentTheme.cssVars.dark : currentTheme.cssVars.light;

                    Object.entries(cssVars).forEach(([property, value]) => {
                        root.style.setProperty(property, value);
                    });
                }
            });
        });

        observer.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ["class"],
        });

        return () => observer.disconnect();
    }, [theme, defaultTheme]);

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
