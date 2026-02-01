const API_URL = import.meta.env.VITE_API_URL || '';

// In production, we must have a valid API_URL.
// In tests, we can fall back to empty string and rely on mocks.
if (!API_URL && import.meta.env.PROD) {
    throw new Error("VITE_API_URL is not defined");
}

/**
 * Hook-like wrapper or just a simple function that accepts the token.
 */
export async function authorizedFetch(
    endpoint: string,
    options: RequestInit = {},
    token?: string,
) {
    // Normalize headers to Headers instance to handle all RequestInit.headers types safely
    const headers = new Headers(options.headers);

    // Set Content-Type if not already present
    if (!headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json');
    }

    if (token) {
        headers.set('Authorization', `Bearer ${token}`);
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
