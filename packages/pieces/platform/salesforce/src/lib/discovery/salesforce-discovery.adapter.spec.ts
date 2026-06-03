import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SalesforceDiscoveryAdapter } from './salesforce-discovery.adapter.js';
import { sfFetch } from '../sf-fetch.js';
import { SF_API_VERSION } from '../common/index.js';
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

vi.mock('../sf-fetch.js', () => ({
    sfFetch: vi.fn(),
    SF_API_VERSION: 'v59.0',
    SalesforceAuthError: class extends Error {
        constructor(message?: string) {
            super(message);
            this.name = 'SalesforceAuthError';
        }
    }
}));

describe('SalesforceDiscoveryAdapter', () => {
    let adapter: SalesforceDiscoveryAdapter;
    let mockAuth: SalesforceAuth;
    let mockStore: TriggerStore;

    const mockSchemaResponse = {
        objectName: 'Contact',
        fields: [
            { name: 'Id', type: 'id' },
            { name: 'FirstName', type: 'string' }
        ],
        childRelationships: [],
        fetchedAt: Date.now()
    };

    beforeEach(() => {
        adapter = new SalesforceDiscoveryAdapter();
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

    describe('describe', () => {

        it('should return schema from TriggerStore cache if present', async () => {
            (mockStore.get as any).mockResolvedValue(mockSchemaResponse);

            const schema = await adapter.describe(mockAuth, 'Contact', mockStore);

            expect(mockStore.get).toHaveBeenCalledWith('igt_schema_https://test.salesforce.com:Contact');
            expect(sfFetch).not.toHaveBeenCalled();
            expect(schema).toEqual(mockSchemaResponse);
        });

        it('should fetch schema from API and cache it if not in TriggerStore', async () => {
            // Store miss
            (mockStore.get as any).mockResolvedValue(null);

            // API hit
            vi.mocked(sfFetch).mockResolvedValueOnce({
                ok: true,
                json: async () => mockSchemaResponse
            } as unknown as Response);

            const schema = await adapter.describe(mockAuth, 'Contact', mockStore);

            expect(sfFetch).toHaveBeenCalledWith(
                `https://test.salesforce.com/services/data/${SF_API_VERSION}/sobjects/Contact/describe`,
                { headers: { Authorization: `Bearer test_token`, Accept: 'application/json' } }
            );

            expect(schema.objectName).toBe('Contact');
            expect(schema.fields).toHaveLength(2);
            expect(schema.fields[0].name).toBe('Id');
            expect(schema.fetchedAt).toBeTypeOf('number');

            // Ensure it was saved to the store
            expect(mockStore.put).toHaveBeenCalledWith(
                'igt_schema_https://test.salesforce.com:Contact',
                expect.objectContaining({ objectName: 'Contact' })
            );
        });

        it('should return schema from in-memory cache on subsequent calls', async () => {
            (mockStore.get as any).mockResolvedValue(mockSchemaResponse);

            // First call hydrates in-memory cache from Store
            await adapter.describe(mockAuth, 'Contact', mockStore);
            expect(mockStore.get).toHaveBeenCalledTimes(1);

            // Second call should return from memory directly
            await adapter.describe(mockAuth, 'Contact', mockStore);
            expect(mockStore.get).toHaveBeenCalledTimes(1);
        });

        it('should throw an error if the Salesforce API call fails', async () => {
            (mockStore.get as any).mockResolvedValue(null);

            vi.mocked(sfFetch).mockRejectedValueOnce(
                new Error('Salesforce API error (404): [{"errorCode":"NOT_FOUND","message":"Not Found"}]')
            );

            await expect(adapter.describe(mockAuth, 'InvalidObject', mockStore))
                .rejects.toThrow('[FieldNotFoundError] Salesforce describe failed for InvalidObject: Salesforce API error (404): [{"errorCode":"NOT_FOUND","message":"Not Found"}]');
        });
    });

    describe('fieldExists', () => {

        it('should return true if field exists in schema', async () => {
            (mockStore.get as any).mockResolvedValue(mockSchemaResponse);

            const exists = await adapter.fieldExists(mockAuth, 'Contact', 'FirstName', mockStore);

            expect(exists).toBe(true);
        });

        it('should return false if field does not exist in schema', async () => {
            (mockStore.get as any).mockResolvedValue(mockSchemaResponse);

            const exists = await adapter.fieldExists(mockAuth, 'Contact', 'MissingField', mockStore);

            expect(exists).toBe(false);
        });
    });

    describe('invalidate', () => {

        it('should remove the schema from both memory and TriggerStore', async () => {
            // Populate memory cache
            (mockStore.get as any).mockResolvedValue(mockSchemaResponse);
            await adapter.describe(mockAuth, 'Contact', mockStore);

            // Invalidate
            await adapter.invalidate(mockAuth, 'Contact', mockStore);

            expect(mockStore.delete).toHaveBeenCalledWith('igt_schema_https://test.salesforce.com:Contact');

            // Next describe should force a store/api check (store get is called)
            await adapter.describe(mockAuth, 'Contact', mockStore);
            expect(mockStore.get).toHaveBeenCalledTimes(2);
        });
    });
});
