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
const simpleRestProvider = dataProviderSimpleRest(API_URL, axiosInstance);

export const dataProvider = {
    ...simpleRestProvider,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    getList: async ({ resource, pagination }: any) => {
        const { current = 1, pageSize = 10 } = pagination ?? {};
        const queryFilters = {}; // TODO: Implement filter mapping if needed

        const url = `${API_URL}/${resource}`;

        const { data } = await axiosInstance.get(url, {
            params: {
                page: current,
                pageSize: pageSize,
                ...queryFilters,
            },
        });

        // NestJS API returns { data: [...], total: N }
        return {
            data: data.data,
            total: data.total,
        };
    },
};
