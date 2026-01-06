import { createAuthClient } from "better-auth/react"

const apiURL = import.meta.env.VITE_API_URL;
if (!apiURL) {
    throw new Error("VITE_API_URL is not defined");
}

export const authClient = createAuthClient({
    baseURL: apiURL + "/auth"
})
