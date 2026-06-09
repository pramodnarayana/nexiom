import { describe, it, expect, vi, beforeEach } from 'vitest';
import { 
    callSalesforceApi, 
    querySalesforceApi, 
    createBulkJob, 
    uploadToBulkJob, 
    notifyBulkJobComplete, 
    getBulkJobInfo,
    SF_API_VERSION,
    SF_BULK_API_VERSION
} from './index.js';
import { httpClient, HttpMethod, AuthenticationType } from '@soopa/piece-framework';

// Mock the HTTP client
vi.mock('@soopa/piece-framework', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@soopa/piece-framework')>();
    return {
        ...actual,
        httpClient: {
            sendRequest: vi.fn(),
        }
    };
});

describe('salesforce common', () => {
    const mockAuth = {
        data: { instance_url: 'https://test.salesforce.com' },
        access_token: 'test_token',
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('callSalesforceApi', () => {
        it('should call Salesforce API with correct parameters', async () => {
            const expectedResponse = { body: { id: '123' }, status: 200 };
            (httpClient.sendRequest as any).mockResolvedValueOnce(expectedResponse);

            const response = await callSalesforceApi(HttpMethod.POST, mockAuth, '/services/data/v59.0/sobjects/Account', { Name: 'Test' });

            expect(httpClient.sendRequest).toHaveBeenCalledWith({
                method: HttpMethod.POST,
                url: 'https://test.salesforce.com/services/data/v59.0/sobjects/Account',
                body: { Name: 'Test' },
                authentication: {
                    type: AuthenticationType.BEARER_TOKEN,
                    token: 'test_token',
                }
            });
            expect(response).toEqual(expectedResponse);
        });
    });

    describe('querySalesforceApi', () => {
        it('should query Salesforce API correctly', async () => {
            await querySalesforceApi(HttpMethod.GET, mockAuth, 'SELECT Id FROM Account');

            expect(httpClient.sendRequest).toHaveBeenCalledWith({
                method: HttpMethod.GET,
                url: `https://test.salesforce.com/services/data/${SF_API_VERSION}/query`,
                queryParams: {
                    q: 'SELECT Id FROM Account',
                },
                authentication: {
                    type: AuthenticationType.BEARER_TOKEN,
                    token: 'test_token',
                }
            });
        });
    });

    describe('Bulk API', () => {
        it('should create bulk job', async () => {
            await createBulkJob(HttpMethod.POST, mockAuth, { object: 'Account', operation: 'insert' });

            expect(httpClient.sendRequest).toHaveBeenCalledWith({
                method: HttpMethod.POST,
                url: `https://test.salesforce.com/services/data/${SF_BULK_API_VERSION}/jobs/ingest/`,
                body: { object: 'Account', operation: 'insert' },
                authentication: {
                    type: AuthenticationType.BEARER_TOKEN,
                    token: 'test_token',
                }
            });
        });

        it('should upload to bulk job', async () => {
            await uploadToBulkJob(HttpMethod.PUT, mockAuth, 'job123', 'Name\\nTest');

            expect(httpClient.sendRequest).toHaveBeenCalledWith({
                method: HttpMethod.PUT,
                url: `https://test.salesforce.com/services/data/${SF_BULK_API_VERSION}/jobs/ingest/job123/batches`,
                headers: { 'Content-Type': 'text/csv' },
                body: 'Name\\nTest',
                authentication: {
                    type: AuthenticationType.BEARER_TOKEN,
                    token: 'test_token',
                }
            });
        });

        it('should notify bulk job complete', async () => {
            await notifyBulkJobComplete(HttpMethod.PATCH, mockAuth, { state: 'UploadComplete' }, 'job123');

            expect(httpClient.sendRequest).toHaveBeenCalledWith({
                method: HttpMethod.PATCH,
                url: `https://test.salesforce.com/services/data/${SF_BULK_API_VERSION}/jobs/ingest/job123`,
                body: { state: 'UploadComplete' },
                authentication: {
                    type: AuthenticationType.BEARER_TOKEN,
                    token: 'test_token',
                }
            });
        });

        it('should get bulk job info', async () => {
            await getBulkJobInfo(HttpMethod.GET, mockAuth, 'job123');

            expect(httpClient.sendRequest).toHaveBeenCalledWith({
                method: HttpMethod.GET,
                url: `https://test.salesforce.com/services/data/${SF_BULK_API_VERSION}/jobs/ingest/job123`,
                authentication: {
                    type: AuthenticationType.BEARER_TOKEN,
                    token: 'test_token',
                }
            });
        });
    });
});
