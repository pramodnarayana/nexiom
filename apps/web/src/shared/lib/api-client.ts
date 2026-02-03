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
