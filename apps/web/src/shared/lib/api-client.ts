import axios from 'axios';

const apiURL = import.meta.env.VITE_API_URL;

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
