const API_URL = import.meta.env.VITE_API_URL;
if (!API_URL) throw new Error("VITE_API_URL is not defined");

/**
 * Hook-like wrapper or just a simple function that accepts the token.
 */
export async function authorizedFetch(
    token: string | undefined,
    endpoint: string,
    options: RequestInit = {}
) {
    // Token might be undefined if cookie-based; that's fine now.

    const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        ...options.headers,
    };

    const response = await fetch(`${API_URL}${endpoint}`, {
        ...options,
        headers,
        credentials: 'include', // Ensure cookies are sent (vital for AuthGuard to pick up session if Bearer token is missing)
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Unknown Error' }));
        throw new Error(error.message || `API Error: ${response.statusText}`);
    }

    return response.json();
}
