"use client";

import dataProviderSimpleRest from "@refinedev/simple-rest";

const API_URL = import.meta.env.VITE_API_URL;

if (!API_URL) {
    throw new Error("VITE_API_URL is not defined in the environment variables.");
}

import axios from "axios";

const axiosInstance = axios.create({
    withCredentials: true
});

// Refine's simple-rest provider usually accepts the axios instance as the second argument
// or as part of the configuration if using the new standard.
// For @refinedev/simple-rest specifically, the signature is (apiUrl, axiosInstance).
export const dataProvider = dataProviderSimpleRest(API_URL, axiosInstance);
