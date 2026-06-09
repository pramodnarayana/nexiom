import { describe, it, expect, vi, beforeEach } from 'vitest';
import { quickbooks } from './index.js';
import { NativeFetchAdapter, QuickBooksFetchError } from './adapters/native-fetch.adapter.js';

describe('quickbooks piece', () => {
    let getSpy: ReturnType<typeof vi.spyOn>;
    let postSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        vi.clearAllMocks();
        getSpy = vi.spyOn(NativeFetchAdapter.prototype, 'get');
        postSpy = vi.spyOn(NativeFetchAdapter.prototype, 'post');
    });

    describe('executeAction', () => {
        const credentials = {
            realmId: '12345',
            access_token: 'token123',
            vendorParams: { environment: 'test' }
        };

        it('should execute simple post successfully', async () => {
            const successResponse = {
                Customer: { Id: 'cus_1', DisplayName: 'John' }
            };
            postSpy.mockResolvedValueOnce({
                status: 200,
                data: successResponse,
                headers: {}
            });

            const result = await quickbooks.executeAction!('Customer', { DisplayName: 'John', _internalTag: 'ignore' }, credentials);

            expect(result.statusCode).toBe(200);
            expect(result.body).toEqual(successResponse);
            expect(result.entityId).toBe('cus_1');
            
            // Check that it stripped internal fields
            const call = postSpy.mock.calls[0];
            const fetchBody = call[2];
            expect(fetchBody).toEqual({ DisplayName: 'John' }); // _internalTag stripped
        });

        it('should handle SyncToken stale error and retry automatically', async () => {
            const staleErrorBody = {
                Fault: {
                    Error: [{ code: '5010', Message: 'Stale Object Error' }]
                }
            };
            
            const freshEntityBody = {
                Customer: { Id: 'cus_1', SyncToken: '2' }
            };

            const successResponse = {
                Customer: { Id: 'cus_1', SyncToken: '3', DisplayName: 'Jane' }
            };

            // 1st POST - Stale Error
            postSpy.mockRejectedValueOnce(new QuickBooksFetchError(`QuickBooks API error 400: ${JSON.stringify(staleErrorBody)}`, 400));

            // GET latest - returns new SyncToken
            getSpy.mockResolvedValueOnce({
                status: 200,
                data: freshEntityBody,
                headers: {}
            });

            // 2nd POST - Success
            postSpy.mockResolvedValueOnce({
                status: 200,
                data: successResponse,
                headers: {}
            });

            const result = await quickbooks.executeAction!('Customer', { Id: 'cus_1', DisplayName: 'Jane', SyncToken: '1' }, credentials);

            expect(postSpy).toHaveBeenCalledTimes(2);
            expect(getSpy).toHaveBeenCalledTimes(1);
            
            const retryPostCall = postSpy.mock.calls[1];
            const retryBody = retryPostCall[2];
            expect(retryBody).toEqual({ Id: 'cus_1', DisplayName: 'Jane', SyncToken: '2' }); // Used fresh token

            expect(result.statusCode).toBe(200);
            expect(result.body).toEqual(successResponse);
        });

        it('should handle timeout correctly', async () => {
            const timeoutError = new Error('Timeout');
            timeoutError.name = 'TimeoutError';
            postSpy.mockRejectedValueOnce(timeoutError);

            await expect(quickbooks.executeAction!('Customer', { DisplayName: 'John' }, credentials))
                .rejects.toThrow('QuickBooks API request timed out after 15s executing Customer');
        });

        it('should handle standard error', async () => {
            postSpy.mockRejectedValueOnce(new Error('Standard Error'));

            await expect(quickbooks.executeAction!('Customer', { DisplayName: 'John' }, credentials))
                .rejects.toThrow('Standard Error');
        });

        it('should handle SyncToken stale error and return silently if get latest fails', async () => {
            const staleErrorBody = {
                Fault: {
                    Error: [{ code: '5010', Message: 'Stale Object Error' }]
                }
            };

            // 1st POST - Stale Error
            postSpy.mockRejectedValueOnce(new QuickBooksFetchError(`QuickBooks API error 400: ${JSON.stringify(staleErrorBody)}`, 400));

            // GET latest - fails
            getSpy.mockRejectedValueOnce(new Error('Network failure'));

            // It should re-throw the original error, wait, no, the executeAction just returns the first error status!
            // Actually, wait, let's check what it does when fetchLatestEntityRecord fails.
            // It returns null, so freshSyncToken is falsy. Then it does not retry.
            // It just returns the original status and body.
            const result = await quickbooks.executeAction!('Customer', { Id: 'cus_1', DisplayName: 'Jane', SyncToken: '1' }, credentials);

            expect(result.statusCode).toBe(400);
            expect(result.body).toEqual(staleErrorBody);
        });
    });

    describe('describe methods', () => {
        it('should return describeObjects', async () => {
            const objects = await quickbooks.describeObjects!({});
            expect(objects.length).toBeGreaterThan(0);
            expect(objects.find(o => o.name === 'Customer')).toBeDefined();
        });

        it('should return describeConfig', async () => {
            const config = await quickbooks.describeConfig!({});
            expect(config.length).toBeGreaterThan(0);
            expect(config[0].name).toBe('useTaxCode');
        });
    });

    describe('discovery methods', () => {
        it('should return describeObjects from constants', async () => {
            const objects = await quickbooks.describeObjects!({});
            expect(objects.length).toBeGreaterThan(0);
            expect(objects[0].name).toBe('Customer');
        });

        it('should return describeFields from constants', async () => {
            const fields = await quickbooks.describeFields!({}, 'Customer');
            expect(fields.length).toBeGreaterThan(0);
            expect(fields[0].name).toBe('Id');

            const missingFields = await quickbooks.describeFields!({}, 'NonExistentObject');
            expect(missingFields).toEqual([]);
        });

        it('should return describeRelatedObjects from constants', async () => {
            const related = await quickbooks.describeRelatedObjects!({}, 'Invoice');
            expect(related).toEqual([
                { objectName: 'Customer', relationshipType: '1:1', relationField: 'CustomerRef.value' }
            ]);

            const missingRelated = await quickbooks.describeRelatedObjects!({}, 'NonExistentObject');
            expect(missingRelated).toEqual([]);
        });

        it('should return normalize as null', async () => {
            expect(await quickbooks.normalize!('Customer', {})).toBeNull();
        });
    });
});
