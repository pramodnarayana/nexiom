"use client";

import dataProviderSimpleRest from "@refinedev/simple-rest";
import axios from "axios";

const API_URL = import.meta.env.VITE_API_URL || '';

if (!API_URL && import.meta.env.PROD) {
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

import type { GetListParams, CrudFilter } from "@refinedev/core";

export const dataProvider = {
    ...simpleRestProvider,
    getList: async ({ resource, pagination, filters, sorters }: GetListParams) => {
        const { current = 1, pageSize = 10 } = pagination ?? {};

        const queryFilters: Record<string, unknown> = {};

        if (filters && filters.length > 0) {
            // Consolidate into a single-pass loop over filters
            for (const f of filters) {
                if ('field' in f && f.field) {
                    if (f.field === 'q' || f.field === 'search') {
                        if ('value' in f) {
                            queryFilters.search = f.value;
                        }
                    } else if (f.operator === 'eq' && 'value' in f) {
                        queryFilters[f.field] = f.value;
                    }
                }
            }
        }

        if (sorters && sorters.length > 0) {
            // Take the primary sorter
            queryFilters.sort = sorters[0].field;
            queryFilters.sortOrder = sorters[0].order;
        }

        const url = `${API_URL}/${resource}`;

        try {
            const { data } = await axiosInstance.get(url, {
                params: {
                    page: current,
                    pageSize: pageSize,
                    ...queryFilters,
                },
            });

            if (!data || !Array.isArray(data.data)) {
                console.error(`[DataProvider] Invalid response from ${url}:`, data);
                // Fallback or throw? Refine expects { data: [], total: 0 } on list
                return { data: [], total: 0 };
            }

            return {
                data: data.data,
                total: typeof data.total === 'number' ? data.total : data.data.length,
            };
        } catch (error) {
            console.error(`[DataProvider] Error fetching ${resource}:`, error);
            // Re-throw so Refine can show notification
            throw error;
        }
    },
};
