const API_URL = import.meta.env.VITE_API_URL;
if (!API_URL) throw new Error("VITE_API_URL is not defined");

/**
 * Hook-like wrapper or just a simple function that accepts the token.
 */
export async function authorizedFetch(
    endpoint: string,
    options: RequestInit = {},
    token?: string,
) {
    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...options.headers as Record<string, string>,
    };

    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }

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
