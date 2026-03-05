export const SF_API_VERSION = 'v59.0';

/** Thrown when Salesforce returns 401. The caller must refresh / re-auth. */
export class SalesforceAuthError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'SalesforceAuthError';
    }
}

/**
 * Wraps fetch() with:
 *  - Automatic retry + exponential backoff on 429, 500, 503
 *    (respects Retry-After header when present)
 *  - SalesforceAuthError on 401 (not retried — caller must refresh token)
 *  - Throws on all other non-ok responses after exhausting retries
 *
 * Returns the raw Response so callers can call .json() or .text().
 */
export async function sfFetch(
    url: string,
    init: RequestInit,
    maxRetries = 3,
): Promise<Response> {
    let attempt = 0;

    while (true) {
        const response = await fetch(url, init);

        if (response.ok) return response;

        if (response.status === 401) {
            const body = await response.text();
            throw new SalesforceAuthError(
                `Salesforce session expired or token invalid (401): ${body}`,
            );
        }

        const isRetriable =
            response.status === 429 ||
            response.status === 500 ||
            response.status === 503;

        if (isRetriable && attempt < maxRetries) {
            const retryAfter = response.headers.get('Retry-After');
            const delayMs = retryAfter
                ? parseInt(retryAfter, 10) * 1000
                : Math.min(1_000 * 2 ** attempt, 30_000);
            attempt++;
            await new Promise<void>(resolve => setTimeout(resolve, delayMs));
            continue;
        }

        const body = await response.text();
        throw new Error(`Salesforce API error (${response.status}): ${body}`);
    }
}
