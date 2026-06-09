import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SalesforceBulkAdapter } from './salesforce-bulk.adapter.js';
import { NativeFetchAdapter } from '../../adapters/native-fetch.adapter.js';
import type { SalesforceAuth } from '../salesforce-types.js';
import type { TriggerStore } from '@soopa/piece-framework';

vi.mock('@soopa/piece-framework/discovery', async (importOriginal) => {
    const mod = await importOriginal() as any;
    return {
        ...mod,
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
    let mockGet: ReturnType<typeof vi.spyOn>;
    let mockPost: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        mockGet = vi.spyOn(NativeFetchAdapter.prototype, 'get');
        mockPost = vi.spyOn(NativeFetchAdapter.prototype, 'post');
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
        mockGet.mockRestore();
        mockPost.mockRestore();
    });

    describe('runBulkJob', () => {
        it('should execute a complete bulk job workflow (create, list, stream)', async () => {
            // Run 1: Create Job
            mockPost.mockResolvedValueOnce({
                data: { id: 'job123' }, headers: {}
            });

            const query = 'SELECT Id, Name FROM Account';
            let records = await adapter.runBulkJob(mockAuth, query, mockStore);

            expect(mockPost).toHaveBeenCalledTimes(1);
            expect(records).toEqual([]);
            expect(mockStore.put).toHaveBeenCalledWith('igt_bulk_job_checkpoint', expect.objectContaining({ jobId: 'job123', state: 'IN_PROGRESS' }));

            // Run 2: Poll Status -> JobComplete & Download
            (mockStore.get as any).mockResolvedValue({ jobId: 'job123', state: 'IN_PROGRESS', soql: query });

            mockGet.mockResolvedValueOnce({
                data: { state: 'JobComplete' }, headers: {}
            });

            mockGet.mockResolvedValueOnce({
                headers: {},
                data: '"Id","Name"\n"1","Test"'
            });

            records = await adapter.runBulkJob(mockAuth, query, mockStore);

            expect(mockGet).toHaveBeenCalledTimes(2); // Get Status, Download Results
            expect(records).toEqual([{ Id: '1', Name: 'Test' }]);
            expect(mockStore.delete).toHaveBeenCalledWith('igt_bulk_job_checkpoint');
        });

        it('should recover from an aborted or failed active job and create a new one', async () => {
            // Run 1: Store has an active job, poll status -> Failed
            (mockStore.get as any).mockResolvedValue({ jobId: 'job_failed_123', state: 'IN_PROGRESS', soql: 'SELECT Id FROM Lead' });

            mockGet.mockResolvedValueOnce({
                data: { state: 'Failed', errorMessage: 'Something went wrong' }, headers: {}
            });

            await expect(adapter.runBulkJob(mockAuth, 'SELECT Id FROM Lead', mockStore))
                .rejects.toThrow('Bulk job failed: Something went wrong');

            expect(mockStore.delete).toHaveBeenCalledWith('igt_bulk_job_checkpoint');
            expect(mockGet).toHaveBeenCalledTimes(1);

            // Run 2: Store is now empty, it creates a new job
            (mockStore.get as any).mockResolvedValue(undefined);

            mockPost.mockResolvedValueOnce({
                data: { id: 'new_job_123' }, headers: {}
            });

            const records = await adapter.runBulkJob(mockAuth, 'SELECT Id FROM Lead', mockStore);

            expect(mockStore.put).toHaveBeenCalledWith('igt_bulk_job_checkpoint', expect.objectContaining({ jobId: 'new_job_123', state: 'IN_PROGRESS' }));
            expect(records).toEqual([]);
            expect(mockPost).toHaveBeenCalledTimes(1);
        });

        it('should correctly handle transient network errors while polling bulk job status', async () => {
            (mockStore.get as any).mockResolvedValue({ jobId: 'job123', state: 'IN_PROGRESS', soql: 'SELECT Id FROM Lead' });

            mockGet.mockRejectedValueOnce(new Error('Network error')); // transient

            await expect(adapter.runBulkJob(mockAuth, 'SELECT Id FROM Lead', mockStore))
                .rejects.toThrow('Network error');

            expect(mockStore.delete).not.toHaveBeenCalled();
            expect(mockGet).toHaveBeenCalledTimes(1);
        });

        it('should correctly parse CSV text containing quoted fields with embedded commas and newlines', async () => {
            (mockStore.get as any).mockResolvedValue({ jobId: 'job123', state: 'IN_PROGRESS', soql: 'SELECT Name, Notes FROM Lead' });

            mockGet.mockResolvedValueOnce({
                data: { state: 'JobComplete' }, headers: {}
            });

            const mockCsvData = `"Name","Notes"\n"Smith, John","Line1\nLine2"\n"Doe, Jane","Single Line"`;
            mockGet.mockResolvedValueOnce({
                headers: {},
                data: mockCsvData
            });

            const records = await adapter.runBulkJob(mockAuth, 'SELECT Name, Notes FROM Lead', mockStore);

            expect(records).toEqual([
                { Name: 'Smith, John', Notes: 'Line1\nLine2' },
                { Name: 'Doe, Jane', Notes: 'Single Line' }
            ]);
            expect(mockStore.delete).toHaveBeenCalledWith('igt_bulk_job_checkpoint');
        });

        it('should throw an error if job creation fails', async () => {
            mockPost.mockRejectedValueOnce(
                new Error('Salesforce API error 500: [{"message":"Internal Server Error"}]')
            );

            await expect(adapter.runBulkJob(mockAuth, 'SELECT Id FROM Account', mockStore))
                .rejects.toThrow('Salesforce bulk query job creation failed: Error: Salesforce API error 500: [{"message":"Internal Server Error"}]');
        });
    });
});
