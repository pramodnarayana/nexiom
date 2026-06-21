import { describe, it, expect, vi, beforeEach } from 'vitest';
import { register } from './index.js';
import { NativeFetchAdapter, SalesforceFetchError } from './adapters/native-fetch.adapter.js';
import { SalesforceCredentials } from './domain/salesforce-credentials.value.js';

describe('salesforce piece', () => {
    let getSpy: ReturnType<typeof vi.spyOn>;
    let postSpy: ReturnType<typeof vi.spyOn>;
    let salesforce: ReturnType<typeof register>;

    beforeEach(() => {
        vi.clearAllMocks();
        getSpy = vi.spyOn(NativeFetchAdapter.prototype, 'get');
        postSpy = vi.spyOn(NativeFetchAdapter.prototype, 'post');
        salesforce = register();
    });

    const credentials = {
        instance_url: 'https://test.salesforce.com',
        access_token: 'test_token',
    };

    describe('executeAction', () => {
        it('should execute POST request correctly', async () => {
            postSpy.mockResolvedValueOnce({
                status: 201,
                data: { id: '001_test' },
                headers: {}
            });

            const result = await salesforce.executeAction!('Account', { Name: 'Test' }, credentials);

            expect(postSpy).toHaveBeenCalledTimes(1);
            expect(postSpy.mock.calls[0][0]).toBe('https://test.salesforce.com/services/data/v59.0/sobjects/Account');
            expect(postSpy.mock.calls[0][2]).toEqual({ Name: 'Test' });
            
            expect(result).toEqual({ statusCode: 201, body: { id: '001_test' } });
        });

        it('should handle SalesforceFetchError', async () => {
            postSpy.mockRejectedValueOnce(new SalesforceFetchError(`Error: {"errorCode":"INVALID_FIELD"}`, 400));
            
            const result = await salesforce.executeAction!('Account', {}, credentials);
            expect(result).toEqual({ statusCode: 400, body: { errorCode: 'INVALID_FIELD' } });
        });

        it('should handle SalesforceFetchError with invalid json', async () => {
            postSpy.mockRejectedValueOnce(new SalesforceFetchError(`Error: Invalid JSON`, 400));

            const result = await salesforce.executeAction!('Account', {}, credentials);
            expect(result).toEqual({ statusCode: 400, body: {} });
        });

        it('should handle adapter-shaped Salesforce error payload', async () => {
            postSpy.mockRejectedValueOnce(new SalesforceFetchError('Error: [{"message":"Some msg","errorCode":"INVALID_FIELD"}]', 400));

            const result = await salesforce.executeAction!('Account', {}, credentials);
            expect(result).toEqual({ statusCode: 400, body: [{ message: 'Some msg', errorCode: 'INVALID_FIELD' }] });
        });

        it('should handle timeout error', async () => {
            const timeoutError = new Error('Timeout');
            timeoutError.name = 'TimeoutError';
            postSpy.mockRejectedValueOnce(timeoutError);

            await expect(salesforce.executeAction!('Account', {}, credentials))
                .rejects.toThrow('Timeout');
        });
    });

    describe('executeFetch', () => {
        it('should fetch record successfully', async () => {
            getSpy.mockResolvedValueOnce({
                status: 200,
                data: { Id: '123', Name: 'Test' },
                headers: {}
            });

            const result = await salesforce.executeFetch!('Account', '123', credentials);

            expect(result).toEqual({ Id: '123', Name: 'Test' });
        });

        it('should return null on 404', async () => {
            getSpy.mockRejectedValueOnce(new SalesforceFetchError('Not Found', 404));

            const result = await salesforce.executeFetch!('Account', '123', credentials);

            expect(result).toBeNull();
        });
    });

    describe('discovery methods', () => {
        it('should return describeObjects', async () => {
            getSpy.mockResolvedValueOnce({
                status: 200,
                data: {
                    sobjects: [
                        { name: 'Account', label: 'Account', queryable: true },
                        { name: 'InternalObj', label: 'Internal', queryable: false },
                        { name: 'Custom__c', label: 'Custom', queryable: false }
                    ]
                },
                headers: {}
            });

            const objects = await salesforce.describeObjects!(credentials);

            expect(getSpy).toHaveBeenCalledTimes(1);
            expect(objects).toEqual([
                { name: 'Custom__c', label: 'Custom', queryable: false }, // custom objects preserved
                { name: 'Account', label: 'Account', queryable: true }
            ]);
        });

        it('should return describeFields', async () => {
            getSpy.mockResolvedValueOnce({
                status: 200,
                data: {
                    fields: [
                        { name: 'Id', label: 'Record Id', type: 'id', filterable: true, sortable: true, nillable: false },
                        { name: 'OwnerId', label: 'Owner', type: 'reference', filterable: true, sortable: true, nillable: true, referenceTo: ['User'] }
                    ]
                },
                headers: {}
            });

            const fields = await salesforce.describeFields!(credentials, 'Account');

            expect(fields).toEqual([
                { name: 'Id', label: 'Record Id', type: 'id', filterable: true, sortable: true, nillable: false },
                { name: 'OwnerId', label: 'Owner', type: 'reference', filterable: true, sortable: true, nillable: true, referenceTo: ['User'] }
            ]);
        });

        it('should return describeRelatedObjects', async () => {
            getSpy.mockResolvedValueOnce({
                status: 200,
                data: {
                    childRelationships: [
                        { childSObject: 'Contact', field: 'AccountId', relationshipName: 'Contacts' }
                    ],
                    fields: [
                        { type: 'reference', referenceTo: ['User'], name: 'OwnerId', label: 'Owner ID' },
                        { type: 'string', name: 'Name', label: 'Account Name' }
                    ]
                },
                headers: {}
            });

            const related = await salesforce.describeRelatedObjects!(credentials, 'Account');

            expect(related).toEqual([
                { objectName: 'Contact', relationField: 'AccountId', relationshipType: '1:N' },
                { objectName: 'User', relationField: 'OwnerId', relationLabel: 'Owner ID', relationshipType: '1:1' }
            ]);
        });
    });

    describe('validateConnection', () => {
        it('should resolve immediately if not revenova profile', async () => {
            await expect(salesforce.validateConnection!({}, {}, undefined)).resolves.toBeUndefined();
            await expect(salesforce.validateConnection!({}, {}, 'default')).resolves.toBeUndefined();
        });

        it('should throw if revenova package is not installed', async () => {
            getSpy.mockResolvedValueOnce({ status: 200, data: { records: [] }, headers: {} }); // PackageLicense
            getSpy.mockResolvedValueOnce({ status: 200, data: { records: [] }, headers: {} }); // InstalledSubscriberPackage

            await expect(salesforce.validateConnection!(credentials, {}, 'revenova'))
                .rejects.toThrow('Connection rejected: Revenova TMS is not installed');
        });

        it('should succeed if rtms namespace exists', async () => {
            getSpy.mockResolvedValueOnce({ status: 200, data: { records: [{ NamespacePrefix: 'rtms' }] }, headers: {} }); // PackageLicense
            getSpy.mockResolvedValueOnce({ status: 200, data: { records: [] }, headers: {} }); // InstalledSubscriberPackage

            await expect(salesforce.validateConnection!(credentials, {}, 'revenova')).resolves.toBeUndefined();
        });

        it('should succeed if revenova package exists', async () => {
            getSpy.mockResolvedValueOnce({ status: 200, data: { records: [] }, headers: {} }); // PackageLicense
            getSpy.mockResolvedValueOnce({ status: 200, data: { records: [{ SubscriberPackageName: 'Revenova TMS' }] }, headers: {} }); // InstalledSubscriberPackage

            await expect(salesforce.validateConnection!(credentials, {}, 'revenova')).resolves.toBeUndefined();
        });

        it('should throw api error if both queries fail', async () => {
            getSpy.mockRejectedValue(new Error('API Failure'));

            await expect(salesforce.validateConnection!(credentials, {}, 'revenova'))
                .rejects.toThrow('Could not verify Revenova TMS installation');
        });
    });

    describe('describeConfig', () => {
        it('should return config array', async () => {
            const config = await salesforce.describeConfig!({});
            expect(config[0].name).toBe('duplicateStrategy');
        });
    });

    describe('normalize', () => {
        it('should return null', async () => {
            const res = await salesforce.normalize!('Account', {});
            expect(res).toBeNull();
        });
    });

    describe('executeFind', () => {
        it('should execute find', async () => {
            getSpy.mockResolvedValueOnce({ status: 200, data: { sobjects: [{ name: 'Account', queryable: true }] }, headers: {} });
            getSpy.mockResolvedValueOnce({ status: 200, data: { fields: [{ name: 'Name', filterable: true }] }, headers: {} });
            getSpy.mockResolvedValueOnce({ status: 200, data: { records: [{ Id: '123' }] }, headers: {} });
            const res = await salesforce.executeFind!('Account', { Name: 'Test' }, credentials);
            expect(res).toEqual([{ Id: '123' }]);
        });
    });

    describe('customApiAction', () => {
        it('should extract baseUrl correctly', async () => {
            const action = salesforce.actions?.['salesforce_custom_api_call'];
            if (action) {
                // @ts-expect-error accessing private property for testing
                const baseUrlFn = action.requireAuth ? action.requireAuth.baseUrl : null;
                if (typeof baseUrlFn === 'function') {
                    expect(baseUrlFn({ data: { instance_url: 'test1' } })).toBe('test1');
                    expect(baseUrlFn({ instance_url: 'test2' })).toBe('test2');
                }
            }
        });
    });

    describe('index exports', () => {
        it('should countRecords', async () => {
            getSpy.mockResolvedValueOnce({ status: 200, data: { totalSize: 5 }, headers: {} });
            const res = await salesforce.countRecords!(credentials, 'Account');
            expect(res).toBe(5);
        });

        it('should describeStreams', async () => {
            getSpy.mockResolvedValueOnce({ status: 200, data: { sobjects: [{ name: 'Account', label: 'Account', queryable: true }] }, headers: {} });
            const res = await salesforce.describeStreams!(credentials);
            expect(res).toHaveLength(1);
        });

        it('should poll', async () => {
            // poll() calls describeFields() first to build the SOQL SELECT field list
            getSpy.mockResolvedValueOnce({ status: 200, data: { fields: [{ name: 'Id', label: 'ID', type: 'id', filterable: true, sortable: true, nillable: false }] }, headers: {} });
            // then fetches the records
            getSpy.mockResolvedValueOnce({ status: 200, data: { records: [{ Id: '123' }], done: true }, headers: {} });
            const res = await salesforce.poll!(credentials, 'Account', { from: '0', to: '1' });
            expect(res.records).toHaveLength(1);
        });
    });

    describe('SalesforceCredentials', () => {
        it('throws if missing url', () => {
            expect(() => SalesforceCredentials.fromRecord({})).toThrow('missing instance_url');
        });
        it('throws if missing token', () => {
            expect(() => SalesforceCredentials.fromRecord({ instance_url: 'u' })).toThrow('missing accessToken');
        });
        it('handles data wrapper', () => {
            const c = SalesforceCredentials.fromRecord({ data: { instance_url: 'u' }, access_token: 't' });
            expect(c.instanceUrl).toBe('u');
            expect(c.accessToken).toBe('t');
        });
    });
});
