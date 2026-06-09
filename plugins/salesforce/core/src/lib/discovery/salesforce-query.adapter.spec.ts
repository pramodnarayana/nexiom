import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SalesforceQueryAdapter } from './salesforce-query.adapter.js';
import type { ObjectSchema } from '@soopa/piece-framework/discovery';

describe('SalesforceQueryAdapter', () => {
    let adapter: SalesforceQueryAdapter;

    const mockSchema: ObjectSchema = {
        objectName: 'Contact',
        fields: [
            { name: 'Id', type: 'id', filterable: true, sortable: true, nillable: false },
            { name: 'FirstName', type: 'string', filterable: true, sortable: true, nillable: true },
            { name: 'LastName', type: 'string', filterable: true, sortable: true, nillable: true },
            { name: 'SystemModstamp', type: 'datetime', filterable: true, sortable: true, nillable: false }
        ],
        childRelationships: [],
        fetchedAt: Date.now()
    };

    beforeEach(() => {
        adapter = new SalesforceQueryAdapter();
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    describe('buildQuery', () => {
        it('should throw an error if the cursorField does not exist in the schema', () => {
            expect(() => {
                adapter.buildQuery(mockSchema, {
                    objectName: 'Contact',
                    cursorField: 'NonExistentField',
                    cursorValue: '2026-03-01T00:00:00.000Z',
                    limit: 100
                });
            }).toThrowError('Invalid cursorField: \'NonExistentField\' not found on object \'Contact\'');
        });

        it('should throw descriptive errors for non-finite or negative limits', () => {
            const invalidLimits = [-1, Number.NaN, Infinity];
            for (const limit of invalidLimits) {
                expect(() => {
                    adapter.buildQuery(mockSchema, {
                        objectName: 'Contact',
                        cursorField: 'SystemModstamp',
                        cursorValue: '2026-03-01T00:00:00.000Z',
                        limit: limit
                    });
                }).toThrowError(`Invalid limit: ${limit}`);
            }
        });

        it('should generate a standard SOQL query with all fields', () => {
            const result = adapter.buildQuery(mockSchema, {
                objectName: 'Contact',
                cursorField: 'SystemModstamp',
                cursorValue: '2026-03-01T00:00:00.000Z',
                limit: 100
            });

            expect(result).toBe("SELECT Id, FirstName, LastName, SystemModstamp FROM Contact WHERE SystemModstamp > 2026-03-01T00:00:00.000Z ORDER BY SystemModstamp ASC LIMIT 100");
        });

        it('should omit LIMIT if explicitly requested', () => {
            const result = adapter.buildQuery(mockSchema, {
                objectName: 'Contact',
                cursorField: 'SystemModstamp',
                cursorValue: '2026-03-01T00:00:00.000Z',
                omitLimit: true
            });

            expect(result).toBe("SELECT Id, FirstName, LastName, SystemModstamp FROM Contact WHERE SystemModstamp > 2026-03-01T00:00:00.000Z ORDER BY SystemModstamp ASC");
        });

        it('should throw error for invalid cursor format', () => {
            expect(() => {
                adapter.buildQuery(mockSchema, {
                    objectName: 'Contact',
                    cursorField: 'SystemModstamp',
                    cursorValue: 'INVALID_CURSOR!@#',
                    limit: 100
                });
            }).toThrowError('Invalid cursor format: INVALID_CURSOR!@#');
        });
    });

    describe('buildCountQuery', () => {
        it('should generate a valid COUNT SOQL query', () => {
            const result = adapter.buildCountQuery(mockSchema, {
                objectName: 'Contact',
                cursorField: 'SystemModstamp',
                cursorValue: '2026-03-01T00:00:00.000Z'
            });

            expect(result).toBe("SELECT COUNT() FROM Contact WHERE SystemModstamp > 2026-03-01T00:00:00.000Z");
        });

        it('should always generate COUNT() for any schema', () => {
            const noIdSchema: ObjectSchema = {
                objectName: 'CustomObj__c',
                fields: [
                    { name: 'Name', type: 'string', filterable: true, sortable: true, nillable: true },
                    { name: 'CreatedDate', type: 'datetime', filterable: true, sortable: true, nillable: false }
                ],
                childRelationships: [],
                fetchedAt: Date.now()
            };

            const result = adapter.buildCountQuery(noIdSchema, {
                objectName: 'CustomObj__c',
                cursorField: 'CreatedDate',
                cursorValue: '2026-03-01T00:00:00.000Z'
            });

            expect(result).toBe("SELECT COUNT() FROM CustomObj__c WHERE CreatedDate > 2026-03-01T00:00:00.000Z");
        });
    });
});
