import type { TriggerStore } from '@soopa/piece-framework';
import { NativeFetchAdapter, SalesforceFetchError } from './native-fetch.adapter.js';
import { SF_API_VERSION } from '../lib/common/index.js';

export type CheckApiLimitsFn = (
    auth: { instance_url: string; access_token: string },
    store: TriggerStore,
    signal?: AbortSignal
) => Promise<{ remaining: number; total: number } | null>;

export const checkSalesforceLimits: CheckApiLimitsFn = async (auth, store, signal) => {
    const CACHE_KEY = `sf_limits_${auth.instance_url}`;
    const POLL_INTERVAL = getPollIntervalMs();

    const cached = await store.get<{ timestamp: number; limits: { remaining: number; total: number } }>(CACHE_KEY);
    if (cached && (Date.now() - cached.timestamp < POLL_INTERVAL)) {
        return cached.limits;
    }

    try {
        const url = `${auth.instance_url}/services/data/${SF_API_VERSION}/limits`;
        const http = new NativeFetchAdapter();
        const { data } = await http.get<Record<string, unknown>>(url, {
            Authorization: `Bearer ${auth.access_token}`,
            Accept: 'application/json'
        }, signal);

        const dailyReq = data?.DailyApiRequests as Record<string, number> | undefined;
        if (dailyReq) {
            const limits = {
                total: dailyReq.Max ?? 0,
                remaining: dailyReq.Remaining ?? 0,
            };
            await store.put(CACHE_KEY, { timestamp: Date.now(), limits });
            return limits;
        }
    } catch (e: unknown) {
        if (e instanceof SalesforceFetchError && isRateLimitExceededException(e)) {
            const limits = { total: 1, remaining: 0 };
            await store.put(CACHE_KEY, { timestamp: Date.now(), limits });
            return limits;
        }
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

function isRateLimitExceededException(e: SalesforceFetchError): boolean {
    if (e.status === 403) {
        if (e.message.includes('REQUEST_LIMIT_EXCEEDED')) {
            return true;
        }
    }
    return false;
}
