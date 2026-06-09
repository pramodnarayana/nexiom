import { describe, it, expect, vi, beforeEach } from 'vitest';
import { checkSalesforceLimits } from './salesforce-limits.js';
import { NativeFetchAdapter, SalesforceFetchError } from './native-fetch.adapter.js';
import type { TriggerStore } from '@soopa/piece-framework';

describe('checkSalesforceLimits', () => {
    let mockStore: TriggerStore;
    let getSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        vi.clearAllMocks();
        mockStore = {
            get: vi.fn(),
            put: vi.fn(),
            delete: vi.fn(),
        };
        getSpy = vi.spyOn(NativeFetchAdapter.prototype, 'get');
    });

    it('should return cached limits if within poll interval', async () => {
        vi.mocked(mockStore.get).mockResolvedValueOnce({
            timestamp: Date.now() - 1000,
            limits: { remaining: 50, total: 100 }
        });

        const limits = await checkSalesforceLimits({ instance_url: 'url', access_token: 'token' }, mockStore);
        expect(limits).toEqual({ remaining: 50, total: 100 });
        expect(getSpy).not.toHaveBeenCalled();
    });

    it('should fetch new limits if cache expired', async () => {
        vi.mocked(mockStore.get).mockResolvedValueOnce({
            timestamp: Date.now() - 20 * 60 * 1000, // 20 mins ago
            limits: { remaining: 50, total: 100 }
        });

        getSpy.mockResolvedValueOnce({
            status: 200,
            data: { DailyApiRequests: { Max: 200, Remaining: 150 } },
            headers: {}
        });

        const limits = await checkSalesforceLimits({ instance_url: 'url', access_token: 'token' }, mockStore);
        expect(limits).toEqual({ remaining: 150, total: 200 });
        expect(getSpy).toHaveBeenCalledTimes(1);
        expect(mockStore.put).toHaveBeenCalled();
    });

    it('should return {0, 1} if rate limit exceeded exception', async () => {
        vi.mocked(mockStore.get).mockResolvedValueOnce(null);
        getSpy.mockRejectedValueOnce(new SalesforceFetchError('REQUEST_LIMIT_EXCEEDED', 403));

        const limits = await checkSalesforceLimits({ instance_url: 'url', access_token: 'token' }, mockStore);
        expect(limits).toEqual({ remaining: 0, total: 1 });
        expect(mockStore.put).toHaveBeenCalled();
    });

    it('should throw on other errors', async () => {
        vi.mocked(mockStore.get).mockResolvedValueOnce(null);
        getSpy.mockRejectedValueOnce(new SalesforceFetchError('Other Error', 500));

        await expect(checkSalesforceLimits({ instance_url: 'url', access_token: 'token' }, mockStore))
            .rejects.toThrow('Other Error');
    });
});
