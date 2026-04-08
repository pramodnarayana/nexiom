import axios from 'axios';

const apiURL = import.meta.env.VITE_API_URL;

// Runtime validation to prevent axios falling back to relative URLs
if (!apiURL) {
    const errorMessage = 'VITE_API_URL environment variable is not defined. Please set it in your .env file.';
    if (import.meta.env.DEV) {
        console.error(errorMessage);
        throw new Error(errorMessage);
    } else {
        console.warn(errorMessage + ' Falling back to relative URLs.');
    }
}

export const apiClient = axios.create({
    baseURL: apiURL,
    withCredentials: true,
    headers: {
        'Content-Type': 'application/json',
    },
});

apiClient.interceptors.response.use(
    (response) => response,
    (error) => {
        // Handle global errors (e.g., 401 Redirect) logic if needed
        return Promise.reject(error);
    }
);

/**
 * Returns the fully qualified API URL string.
 */
export const getApiUrl = (): string => apiURL;

/**
 * Enterprise centralized global fetcher for Vercel AI SDK and native web streams.
 * Bypasses Axios internally (since Axios does not support native ReadableStreams well),
 * but preserves the exact same global credential passing protocols.
 */
export const streamFetcher = async (url: string, init?: RequestInit): Promise<Response> => {
    // 1. Maintain the global identity cookies automatically across boundaries just like apiClient
    console.log('🚀 streamFetcher invoked for URL:', url);
    console.log('🚀 streamFetcher RequestInit:', init);

    const finalInit = {
        ...init,
        credentials: 'include' as RequestCredentials,
    };

    // 2. Wrap network events
    console.log('🚀 streamFetcher about to execute fetch...');
    const response = await fetch(url, finalInit);
    console.log('🚀 streamFetcher received response status:', response.status);

    // 3. Centralized intercepts: globally handle auth expiration
    if (response.status === 401) {
        // In a full implementation, you could dispatch a global sign-out event here.
        console.error('Streaming request rejected: session expired (401).');
    }

    return response;
};
