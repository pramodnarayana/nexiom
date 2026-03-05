export const SF_API_VERSION = 'v59.0';

/** Thrown when Salesforce returns 401. The caller must refresh / re-auth. */
export class SalesforceAuthError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'SalesforceAuthError';
    }
}

export interface ApiLimitsStore {
    get<T>(key: string): Promise<T | null>;
    put<T>(key: string, value: T): Promise<void>;
}

export async function checkSalesforceLimits(
    auth: { instance_url: string; access_token: string },
    store: ApiLimitsStore
): Promise<{ remaining: number; total: number } | null> {
    const CACHE_KEY = `sf_limits_${auth.instance_url}`;
    const POLL_INTERVAL = process.env.SF_LIMITS_POLL_INTERVAL_MS
        ? Number.parseInt(process.env.SF_LIMITS_POLL_INTERVAL_MS, 10)
        : 15 * 60 * 1000;

    const cached = await store.get<{ timestamp: number; limits: { remaining: number; total: number } }>(CACHE_KEY);
    if (cached && (Date.now() - cached.timestamp < POLL_INTERVAL)) {
        return cached.limits;
    }

    try {
        const url = `${auth.instance_url}/services/data/${SF_API_VERSION}/limits`;
        const response = await sfFetch(url, {
            headers: { Authorization: `Bearer ${auth.access_token}`, Accept: 'application/json' }
        });

        if (response.ok) {
            const data = await response.json();
            if (data.DailyApiRequests) {
                const limits = {
                    total: data.DailyApiRequests.Max,
                    remaining: data.DailyApiRequests.Remaining,
                };
                await store.put(CACHE_KEY, { timestamp: Date.now(), limits });
                return limits;
            }
        } else if (response.status === 403) {
            const body = await response.text();
            if (body.includes('REQUEST_LIMIT_EXCEEDED')) {
                const limits = { total: 1, remaining: 0 };
                await store.put(CACHE_KEY, { timestamp: Date.now(), limits });
                return limits;
            }
        }
    } catch (e) {
        // Ignore limit check errors to avoid breaking the main flow
        console.debug('Failed to check Salesforce limits', e);
    }
    return null;
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
                ? Number.parseInt(retryAfter, 10) * 1000
                : Math.min(1_000 * 2 ** attempt, 30_000);
            attempt++;
            await new Promise<void>(resolve => setTimeout(resolve, delayMs));
            continue;
        }

        const body = await response.text();
        throw new Error(`Salesforce API error (${response.status}): ${body}`);
    }
}

