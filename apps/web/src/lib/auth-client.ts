import { createAuthClient } from "better-auth/react"

const apiURL = import.meta.env.VITE_API_URL;
if (!apiURL) {
    throw new Error("VITE_API_URL is not defined");
}

const getAuthBaseURL = (apiURL: string): string => {
    try {
        // Try to construct absolute URL
        const url = new URL(apiURL, window.location.origin);
        // Ensure clean concatenation of /auth
        url.pathname = url.pathname.replace(/\/$/, '') + '/auth';
        return url.toString();
    } catch {
        // Fallback for edge cases
        return `${apiURL}/auth`;
    }
};

export const authClient = createAuthClient({
    baseURL: getAuthBaseURL(apiURL)
})
