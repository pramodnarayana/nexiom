const QUICKBOOKS_API_URL_SANDBOX = 'https://sandbox-quickbooks.api.intuit.com/v3/company';
const QUICKBOOKS_API_URL_PRODUCTION = 'https://quickbooks.api.intuit.com/v3/company';

export const quickbooksCommon = {
    getApiUrl: (realmId: string, useSandbox: boolean = false) => {
        const baseUrl = useSandbox ? QUICKBOOKS_API_URL_SANDBOX : QUICKBOOKS_API_URL_PRODUCTION;
        return `${baseUrl}/${realmId}`;
    },
};

export interface QuickbooksEntityResponse<T> {
    QueryResponse?: {
        startPosition?: number;
        maxResults?: number;
        totalCount?: number;
    } & Record<Exclude<string, 'startPosition' | 'maxResults' | 'totalCount'>, T[] | undefined>;
    Fault?: {
        Error: {
            Message: string;
            Detail?: string;
            code: string;
        }[];
        type: string;
    };
    time?: string;
} 