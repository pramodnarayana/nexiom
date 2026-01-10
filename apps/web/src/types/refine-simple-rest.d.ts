import type { AxiosInstance } from 'axios';

declare module '@refinedev/simple-rest' {
    export default function dataProviderSimpleRest(
        apiUrl: string,
        httpClient?: AxiosInstance
    ): import('@refinedev/core').DataProvider;
}
