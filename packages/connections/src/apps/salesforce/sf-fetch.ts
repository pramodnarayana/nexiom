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
    let POLL_INTERVAL = 15 * 60 * 1000;
    if (process.env.SF_LIMITS_POLL_INTERVAL_MS) {
        const parsed = Number.parseFloat(process.env.SF_LIMITS_POLL_INTERVAL_MS);
        if (Number.isFinite(parsed) && parsed > 0) {
            POLL_INTERVAL = parsed;
        } else {
            console.warn(`Invalid SF_LIMITS_POLL_INTERVAL_MS: '${process.env.SF_LIMITS_POLL_INTERVAL_MS}'. Using default 15m.`);
        }
    }

    const cached = await store.get<{ timestamp: number; limits: { remaining: number; total: number } }>(CACHE_KEY);
    if (cached && (Date.now() - cached.timestamp < POLL_INTERVAL)) {
        return cached.limits;
    }

    try {
        const url = `${auth.instance_url}/services/data/${SF_API_VERSION}/limits`;
        const response = await sfFetch(url, {
            headers: { Authorization: `Bearer ${auth.access_token}`, Accept: 'application/json' }
        });

        // if we get here, response is OK because sfFetch throws on non-ok (except 403 maybe? Actually sfFetch only returns if ok)
        const data = await response.json();
        if (data.DailyApiRequests) {
            const limits = {
                total: data.DailyApiRequests.Max,
                remaining: data.DailyApiRequests.Remaining,
            };
            await store.put(CACHE_KEY, { timestamp: Date.now(), limits });
            return limits;
        }
    } catch (e: any) {
        if (e.message?.includes('(403)') && e.message?.includes('REQUEST_LIMIT_EXCEEDED')) {
            const limits = { total: 1, remaining: 0 };
            await store.put(CACHE_KEY, { timestamp: Date.now(), limits });
            return limits;
        }
        // Rethrow for other errors
        throw e;
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
            let delayMs = -1;

            if (retryAfter) {
                if (/^\d+$/.test(retryAfter)) {
                    delayMs = Number.parseInt(retryAfter, 10) * 1000;
                } else {
                    const parsedDate = Date.parse(retryAfter);
                    if (!Number.isNaN(parsedDate)) {
                        delayMs = parsedDate - Date.now();
                    }
                }
            }

            if (delayMs <= 0 || Number.isNaN(delayMs)) {
                delayMs = Math.min(1_000 * 2 ** attempt, 30_000);
            }

            attempt++;
            await new Promise<void>(resolve => setTimeout(resolve, delayMs));
            continue;
        }

        const body = await response.text();
        throw new Error(`Salesforce API error (${response.status}): ${body}`);
    }
}

