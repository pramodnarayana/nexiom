import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SalesforceBulkAdapter } from './salesforce-bulk.adapter.js';
import { sfFetch } from '@nexiom/connections/intelligence';
import type { SalesforceAuth } from '@nexiom/connections/intelligence';
import type { TriggerStore } from '@nexiom/connections/framework';

vi.mock('@nexiom/connections/intelligence', async (importOriginal) => {
    const mod = await importOriginal() as any;
    return {
        ...mod,
        sfFetch: vi.fn(),
        IgtLogger: class {
            debug = vi.fn();
            info = vi.fn();
            warn = vi.fn();
            error = vi.fn();
        }
    };
});

describe('SalesforceBulkAdapter', () => {
    let adapter: SalesforceBulkAdapter;
    let mockAuth: SalesforceAuth;
    let mockStore: TriggerStore;

    beforeEach(() => {
        adapter = new SalesforceBulkAdapter();
        mockAuth = {
            access_token: 'test_token',
            instance_url: 'https://test.salesforce.com'
        };
        mockStore = {
            put: vi.fn().mockResolvedValue(undefined),
            get: vi.fn().mockResolvedValue(undefined),
            delete: vi.fn().mockResolvedValue(undefined),
        };
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    describe('runBulkJob', () => {
        it('should execute a complete bulk job workflow (create, list, stream)', async () => {
            // Run 1: Create Job
            vi.mocked(sfFetch).mockResolvedValueOnce({
                ok: true,
                json: async () => ({ id: 'job123' })
            } as unknown as Response);

            const query = 'SELECT Id, Name FROM Account';
            let records = await adapter.runBulkJob(mockAuth, query, mockStore);

            expect(sfFetch).toHaveBeenCalledTimes(1);
            expect(records).toEqual([]);
            expect(mockStore.put).toHaveBeenCalledWith('igt_bulk_job_checkpoint', expect.objectContaining({ jobId: 'job123', state: 'IN_PROGRESS' }));

            // Run 2: Poll Status -> JobComplete & Download
            (mockStore.get as any).mockResolvedValue({ jobId: 'job123', state: 'IN_PROGRESS', soql: query });

            vi.mocked(sfFetch).mockResolvedValueOnce({
                ok: true,
                json: async () => ({ state: 'JobComplete' })
            } as unknown as Response);

            vi.mocked(sfFetch).mockResolvedValueOnce({
                ok: true,
                text: async () => '{"Id":"1","Name":"Test"}'
            } as unknown as Response);

            records = await adapter.runBulkJob(mockAuth, query, mockStore);

            expect(sfFetch).toHaveBeenCalledTimes(3); // +1 Get Status, +1 Download Results
            expect(records).toEqual([{ Id: '1', Name: 'Test' }]);
            expect(mockStore.delete).toHaveBeenCalledWith('igt_bulk_job_checkpoint');
        });

        it('should recover from an aborted or failed active job and create a new one', async () => {
            // Run 1: Store has an active job, poll status -> Failed
            (mockStore.get as any).mockResolvedValue({ jobId: 'job_failed_123', state: 'IN_PROGRESS' });

            vi.mocked(sfFetch).mockResolvedValueOnce({
                ok: true,
                json: async () => ({ state: 'Failed', errorMessage: 'Something went wrong' })
            } as unknown as Response);

            await expect(adapter.runBulkJob(mockAuth, 'SELECT Id FROM Lead', mockStore))
                .rejects.toThrow('Bulk job failed: Something went wrong');

            expect(mockStore.delete).toHaveBeenCalledWith('igt_bulk_job_checkpoint');
            expect(sfFetch).toHaveBeenCalledTimes(1);

            // Run 2: Store is now empty, it creates a new job
            (mockStore.get as any).mockResolvedValue(undefined);

            vi.mocked(sfFetch).mockResolvedValueOnce({
                ok: true,
                json: async () => ({ id: 'new_job_123' })
            } as unknown as Response);

            const records = await adapter.runBulkJob(mockAuth, 'SELECT Id FROM Lead', mockStore);

            expect(mockStore.put).toHaveBeenCalledWith('igt_bulk_job_checkpoint', expect.objectContaining({ jobId: 'new_job_123', state: 'IN_PROGRESS' }));
            expect(records).toEqual([]);
            expect(sfFetch).toHaveBeenCalledTimes(2);
        });

        it('should throw an error if job creation fails', async () => {
            vi.mocked(sfFetch).mockResolvedValueOnce({
                ok: false,
                json: async () => [{ message: 'Internal Server Error' }]
            } as unknown as Response);

            await expect(adapter.runBulkJob(mockAuth, 'SELECT Id FROM Account', mockStore))
                .rejects.toThrow('Salesforce bulk query job creation failed: Internal Server Error');
        });
    });
});
