const QUICKBOOKS_API_URL_SANDBOX = 'https://sandbox-quickbooks.api.intuit.com/v3/company';
const QUICKBOOKS_API_URL_PRODUCTION = 'https://quickbooks.api.intuit.com/v3/company';

/** The two accepted QuickBooks environment identifiers. */
export type QuickBooksEnvironment = 'test' | 'login';

/** Derives the QB environment from auth props, validating and normalising the value.
 *  Accepted values for `environment`:  'test' (sandbox) | 'login' (production).
 *  Falls back to the legacy `useSandbox` boolean when `environment` is absent or invalid. */
export function resolveEnvironment(props?: Record<string, unknown>): QuickBooksEnvironment {
    const raw = props?.['environment'];
    if (typeof raw === 'string') {
        const trimmed = raw.trim();
        if (trimmed === 'test' || trimmed === 'login') {
            return trimmed;
        }
    }
    // Legacy boolean fallback
    const useSandbox = props?.['useSandbox'];
    return useSandbox === true || useSandbox === 'true' ? 'test' : 'login';
}

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
        [key: string]: T[] | number | undefined;
    };
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