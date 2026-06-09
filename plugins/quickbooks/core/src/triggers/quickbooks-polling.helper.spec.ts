import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runQuickBooksQuery } from './quickbooks-polling.helper.js';
import type { TriggerStore } from '@soopa/piece-framework';
import { NativeFetchAdapter, QuickBooksFetchError } from '../adapters/native-fetch.adapter.js';

describe('quickbooks-polling.helper', () => {
    describe('runQuickBooksQuery', () => {
        let mockStore: TriggerStore;
        let getSpy: ReturnType<typeof vi.spyOn>;
        const validAuth = { access_token: 'token', props: { companyId: '123' } };

        beforeEach(() => {
            vi.clearAllMocks();
            mockStore = {
                get: vi.fn(),
                put: vi.fn(),
                delete: vi.fn(),
            };
            getSpy = vi.spyOn(NativeFetchAdapter.prototype, 'get');
        });

        it('should throw if auth missing access_token', async () => {
            await expect(runQuickBooksQuery({ access_token: '', props: { companyId: '123' } }, 'Customer', mockStore))
                .rejects.toThrow('QuickBooks authentication missing or invalid access_token');
        });

        it('should throw if auth missing companyId', async () => {
            await expect(runQuickBooksQuery({ access_token: 'token', props: { companyId: '' } }, 'Customer', mockStore))
                .rejects.toThrow('QuickBooks authentication missing or invalid companyId');
        });

        it('should fetch with fallback cursor', async () => {
            vi.mocked(mockStore.get).mockResolvedValue(null);
            getSpy.mockResolvedValueOnce({
                status: 200,
                data: { QueryResponse: { Customer: [{ Id: '1', MetaData: { LastUpdatedTime: '2023-01-01T00:00:00Z' } }] } },
                headers: {}
            });

            const records = await runQuickBooksQuery(validAuth, 'Customer', mockStore);
            
            expect(records.length).toBe(1);
            expect(getSpy).toHaveBeenCalledTimes(1);
            expect(mockStore.put).toHaveBeenCalledWith(
                'igt_Customer_MetaData.LastUpdatedTime',
                { lastUpdatedTime: '2023-01-01T00:00:00Z', lastId: '1' }
            );
        });

        it('should handle timeout error', async () => {
            vi.mocked(mockStore.get).mockResolvedValue({ lastUpdatedTime: '2023-01-01', lastId: '1' });
            
            const timeoutError = new Error('Timeout');
            timeoutError.name = 'TimeoutError';
            getSpy.mockRejectedValueOnce(timeoutError);

            await expect(runQuickBooksQuery(validAuth, 'Customer', mockStore))
                .rejects.toThrow('QuickBooks query timed out after 15 seconds');
        });

        it('should handle non-ok response', async () => {
            vi.mocked(mockStore.get).mockResolvedValue(null);
            getSpy.mockRejectedValueOnce(new QuickBooksFetchError('Error', 500));

            await expect(runQuickBooksQuery(validAuth, 'Customer', mockStore))
                .rejects.toThrow('QuickBooks query failed with status 500 (response body omitted)');
        });

        it('should handle Fault response', async () => {
            vi.mocked(mockStore.get).mockResolvedValue(null);
            getSpy.mockResolvedValueOnce({
                status: 200,
                data: { Fault: { Error: [] } },
                headers: {}
            });

            await expect(runQuickBooksQuery(validAuth, 'Customer', mockStore))
                .rejects.toThrow('QuickBooks query returned a fault response (fault details omitted)');
        });
    });
});
