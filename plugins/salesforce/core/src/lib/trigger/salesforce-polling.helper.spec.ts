import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runSalesforce, assertSafeSalesforceObject, assertSafeSalesforceField } from './salesforce-polling.helper.js';
import { NativeFetchAdapter } from '../../adapters/native-fetch.adapter.js';
import type { TriggerStore } from '@soopa/piece-framework';

describe('salesforce-polling.helper', () => {
    describe('assertSafeSalesforceObject', () => {
        it('should allow valid objects', () => {
            expect(() => assertSafeSalesforceObject('Account')).not.toThrow();
            expect(() => assertSafeSalesforceObject('CustomObject__c')).not.toThrow();
        });

        it('should throw for invalid objects', () => {
            expect(() => assertSafeSalesforceObject('Account; DROP TABLE;')).toThrow('Invalid Salesforce object name');
            expect(() => assertSafeSalesforceObject('')).toThrow('Invalid Salesforce object name');
            expect(() => assertSafeSalesforceObject('A'.repeat(81))).toThrow('Invalid Salesforce object name');
        });
    });

    describe('assertSafeSalesforceField', () => {
        it('should allow valid fields', () => {
            expect(() => assertSafeSalesforceField('SystemModstamp')).not.toThrow();
            expect(() => assertSafeSalesforceField('CustomField__c')).not.toThrow();
            expect(() => assertSafeSalesforceField('CustomField__r')).not.toThrow();
        });

        it('should throw for invalid fields', () => {
            expect(() => assertSafeSalesforceField('Field; SELECT')).toThrow('Invalid Salesforce field name for SOQL');
            expect(() => assertSafeSalesforceField('Field SELECT')).toThrow('Invalid Salesforce field name for SOQL');
            expect(() => assertSafeSalesforceField('')).toThrow('Invalid Salesforce field name for SOQL');
        });
    });

    describe('runSalesforce', () => {
        let mockStore: TriggerStore;
        const mockAuth = { instance_url: 'https://test.com', access_token: 'token' };

        beforeEach(() => {
            mockStore = {
                get: vi.fn(),
                put: vi.fn(),
                delete: vi.fn(),
            };
        });

        let mockGet: ReturnType<typeof vi.spyOn>;
        beforeEach(() => {
            mockGet = vi.spyOn(NativeFetchAdapter.prototype, 'get');
        });

        afterEach(() => {
            vi.restoreAllMocks();
        });

        it('should poll with fallback date if no cursor exists', async () => {
            vi.mocked(mockStore.get).mockResolvedValue(null);
            
            mockGet.mockResolvedValue({ data: { records: [{ Id: '1', SystemModstamp: '2023-01-01T00:00:00Z' }] }, headers: {} });

            const records = await runSalesforce(
                mockAuth,
                'Account',
                { cursorKey: 'cursor_key', dateField: 'SystemModstamp' },
                mockStore
            );

            expect(records.length).toBe(1);
            expect(mockGet).toHaveBeenCalledTimes(1);
            
            const callUrl = mockGet.mock.calls[0][0] as string;
            const decodedUrl = decodeURIComponent(callUrl);
            expect(decodedUrl).toContain('SELECT Id, SystemModstamp FROM Account');
            expect(decodedUrl).toContain('WHERE SystemModstamp >');
            expect(mockStore.put).toHaveBeenCalledWith(
                'cursor_key',
                JSON.stringify({ sinceDate: '2023-01-01T00:00:00Z', sinceId: '1' })
            );
        });

        it('should poll with simple date cursor', async () => {
            vi.mocked(mockStore.get).mockResolvedValue('2023-01-01T00:00:00Z');
            
            mockGet.mockResolvedValue({ data: { records: [] }, headers: {} });

            await runSalesforce(
                mockAuth,
                'Account',
                { cursorKey: 'cursor_key', dateField: 'SystemModstamp' },
                mockStore
            );

            const callUrl = mockGet.mock.calls[0][0] as string;
            expect(decodeURIComponent(callUrl)).toContain("WHERE SystemModstamp > 2023-01-01T00:00:00Z");
            expect(mockStore.put).not.toHaveBeenCalled(); // No records, so no put
        });

        it('should poll with compound cursor tie-breaker', async () => {
            vi.mocked(mockStore.get).mockResolvedValue(JSON.stringify({ sinceDate: '2023-01-01T00:00:00Z', sinceId: '123' }));
            
            mockGet.mockResolvedValue({ data: { records: [{ Id: '124', SystemModstamp: '2023-01-01T00:00:00Z' }] }, headers: {} });

            await runSalesforce(
                mockAuth,
                'Account',
                { cursorKey: 'cursor_key', dateField: 'SystemModstamp', extraColumns: ['Name'] },
                mockStore
            );

            const callUrl = mockGet.mock.calls[0][0] as string;
            const decodedUrl = decodeURIComponent(callUrl);
            expect(decodedUrl).toContain("SELECT Id, SystemModstamp, Name FROM Account");
            expect(decodedUrl).toContain("WHERE (SystemModstamp > 2023-01-01T00:00:00Z) OR (SystemModstamp = 2023-01-01T00:00:00Z AND Id > '123')");
            expect(mockStore.put).toHaveBeenCalledWith(
                'cursor_key',
                JSON.stringify({ sinceDate: '2023-01-01T00:00:00Z', sinceId: '124' })
            );
        });

        it('should recover from bad JSON cursor', async () => {
            vi.mocked(mockStore.get).mockResolvedValue('{bad:json');
            
            mockGet.mockResolvedValue({ data: { records: [] }, headers: {} });

            await runSalesforce(mockAuth, 'Account', { cursorKey: 'k', dateField: 'SystemModstamp' }, mockStore);

            const callUrl = decodeURIComponent(mockGet.mock.calls[0][0] as string);
            // It should fall back to default date, meaning we shouldn't see '{"bad":"json"}' injected into query
            expect(callUrl).not.toContain('bad');
            expect(callUrl).not.toContain('json');
        });
    });
});
