"use client";

import dataProviderSimpleRest from "@refinedev/simple-rest";
import axios from "axios";

const API_URL = import.meta.env.VITE_API_URL;

if (!API_URL) {
    throw new Error("VITE_API_URL is not defined in the environment variables.");
}

/**
 * Axios instance configured with credentials for cross-origin requests.
 * This enables cookie-based authentication with the API.
 */
const axiosInstance = axios.create({
    withCredentials: true,
});

/**
 * Refine data provider using simple-rest with custom axios instance.
 * Type compatibility is ensured via src/types/refine-simple-rest.d.ts
 */
export const dataProvider = dataProviderSimpleRest(API_URL, axiosInstance);
