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
    const POLL_INTERVAL = getPollIntervalMs();

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
        if (isRateLimitExceededException(e)) {
            const limits = { total: 1, remaining: 0 };
            await store.put(CACHE_KEY, { timestamp: Date.now(), limits });
            return limits;
        }
        // Rethrow for other errors
        throw e;
    }
    return null;
}

function getPollIntervalMs(): number {
    if (!process.env.SF_LIMITS_POLL_INTERVAL_MS) return 15 * 60 * 1000;
    const parsed = Number.parseFloat(process.env.SF_LIMITS_POLL_INTERVAL_MS);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
    console.warn(`Invalid SF_LIMITS_POLL_INTERVAL_MS: '${process.env.SF_LIMITS_POLL_INTERVAL_MS}'. Using default 15m.`);
    return 15 * 60 * 1000;
}

function isRateLimitExceededException(e: any): boolean {
    const status = e.status || e.statusCode || e.response?.status;
    const data = e.data || e.response?.body || e.message;

    if (status === 403) {
        if (
            (Array.isArray(data) && data[0]?.errorCode === 'REQUEST_LIMIT_EXCEEDED') ||
            (typeof data === 'string' && data.includes('REQUEST_LIMIT_EXCEEDED'))
        ) {
            return true;
        }
    }
    return false;
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
        let isTransientError = false;
        let response: Response | undefined;

        try {
            response = await executeFetchWithTimeout(url, init);
        } catch (err: unknown) {
            // Sonarqube: Handle this exception or don't catch it at all
            const errMsg = err instanceof Error ? err.message : String(err);
            console.debug(`[sfFetch] Transient network error encountered: ${errMsg}`);
            isTransientError = true;
        }

        if (response?.ok) return response;

        if (response?.status === 401) {
            const body = await response.text();
            throw new SalesforceAuthError(`Salesforce session expired or token invalid (401): ${body}`);
        }

        if (isRetriableError(isTransientError, response) && attempt < maxRetries) {
            const retryAfter = response?.headers?.get('Retry-After');
            const delayMs = calculateRetryDelayMs(retryAfter, attempt);

            attempt++;
            await new Promise<void>(resolve => setTimeout(resolve, delayMs));
            continue;
        }

        throw await buildSalesforceError(response);
    }
}

function isRetriableError(isTransient: boolean, response?: Response): boolean {
    if (isTransient) return true;
    if (!response) return false;
    return response.status === 429 || response.status === 500 || response.status === 503;
}

async function buildSalesforceError(response?: Response): Promise<Error> {
    const bodyText = response ? await response.text() : 'Network or timeout error';
    const err: any = new Error(`Salesforce API error (${response?.status || 0}): ${bodyText}`);
    err.status = response?.status || 0;
    err.response = { status: response?.status || 0, body: bodyText };
    try {
        err.data = JSON.parse(bodyText);
    } catch {
        // Ignore JSON parse errors for non-JSON bodies
    }
    return err;
}

async function executeFetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    const DEFAULT_FETCH_TIMEOUT_MS = 60_000;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DEFAULT_FETCH_TIMEOUT_MS);

    const onCallerAbort = () => controller.abort(init.signal?.reason);

    if (init.signal) {
        if (init.signal.aborted) {
            controller.abort(init.signal.reason);
        } else {
            init.signal.addEventListener('abort', onCallerAbort);
        }
    }

    const fetchInit: RequestInit = {
        ...init,
        signal: controller.signal
    };

    try {
        return await fetch(url, fetchInit);
    } finally {
        clearTimeout(timeoutId);
        if (init.signal) {
            init.signal.removeEventListener('abort', onCallerAbort);
        }
    }
}

function calculateRetryDelayMs(retryAfter: string | null | undefined, attempt: number): number {
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

        if (delayMs > 0) {
            delayMs = Math.min(delayMs, 30_000);
        }
    }

    if (delayMs <= 0 || Number.isNaN(delayMs)) {
        delayMs = Math.min(1_000 * 2 ** attempt, 30_000);
    }

    return delayMs;
}
