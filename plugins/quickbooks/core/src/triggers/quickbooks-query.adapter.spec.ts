import { describe, it, expect } from 'vitest';
import { QuickBooksQueryAdapter } from './quickbooks-query.adapter.js';

describe('QuickBooksQueryAdapter', () => {

    describe('buildQBOQuery', () => {

        it('should build a standard query with all parameters', () => {
            const result = QuickBooksQueryAdapter.buildQBOQuery('Invoice', {
                cursorField: 'MetaData.LastUpdatedTime',
                cursorValue: '2026-01-01T00:00:00.000Z',
                limit: 100
            });

            expect(result).toBe("SELECT * FROM Invoice WHERE MetaData.LastUpdatedTime > '2026-01-01T00:00:00.000Z' ORDER BY MetaData.LastUpdatedTime ASC MAXRESULTS 100");
        });

        it('should build a query without MAXRESULTS if limit is 0', () => {
            const result = QuickBooksQueryAdapter.buildQBOQuery('Customer', {
                cursorField: 'MetaData.CreateTime',
                cursorValue: '2025-12-31T23:59:59Z',
                limit: 0
            });

            expect(result).toBe("SELECT * FROM Customer WHERE MetaData.CreateTime > '2025-12-31T23:59:59Z' ORDER BY MetaData.CreateTime ASC");
        });

        it('should default to MAXRESULTS 100 if limit is undefined', () => {
            const result = QuickBooksQueryAdapter.buildQBOQuery('Account', {
                cursorField: 'Id',
                cursorValue: '100',
                limit: undefined
            });

            expect(result).toBe("SELECT * FROM Account WHERE Id > '100' ORDER BY Id ASC MAXRESULTS 100");
        });

        it('should throw an error for invalid entityType formats to prevent SQL injection', () => {
            expect(() => {
                QuickBooksQueryAdapter.buildQBOQuery('Invoice; DROP TABLE Invoice', {
                    cursorField: 'Id',
                    cursorValue: '1',
                    limit: 10
                });
            }).toThrowError('Invalid QBO entity type: Invoice; DROP TABLE Invoice');
        });

        it('should throw an error for invalid cursor formats to prevent SQL injection', () => {
            expect(() => {
                QuickBooksQueryAdapter.buildQBOQuery('Invoice', {
                    cursorField: 'Id',
                    cursorValue: "1' OR '1'='1",
                    limit: 10
                });
            }).toThrowError("Invalid cursor format: 1' OR '1'='1");
        });

        it('should throw an error for invalid cursorField formats to prevent SQL injection', () => {
            expect(() => {
                QuickBooksQueryAdapter.buildQBOQuery('Invoice', {
                    cursorField: 'Id; DROP TABLE Invoice',
                    cursorValue: '1',
                    limit: 10
                });
            }).toThrowError('Invalid cursorField: Id; DROP TABLE Invoice');
        });

        it('should throw an error for invalid limit formats to prevent SQL injection', () => {
            expect(() => {
                QuickBooksQueryAdapter.buildQBOQuery('Invoice', {
                    cursorField: 'Id',
                    cursorValue: '1',
                    limit: '10; DROP TABLE' as any
                });
            }).toThrowError('Invalid limit: 10; DROP TABLE');

            expect(() => {
                QuickBooksQueryAdapter.buildQBOQuery('Invoice', {
                    cursorField: 'Id',
                    cursorValue: '1',
                    limit: -5
                });
            }).toThrowError('Invalid limit: -5');
        });

        it('should build a query with cursor tie-break when cursorIdField and cursorIdValue are provided', () => {
            const result = QuickBooksQueryAdapter.buildQBOQuery('Invoice', {
                cursorField: 'MetaData.LastUpdatedTime',
                cursorValue: '2026-01-01T00:00:00.000Z',
                cursorIdField: 'Id',
                cursorIdValue: '123',
                limit: 50
            });

            expect(result).toBe("SELECT * FROM Invoice WHERE MetaData.LastUpdatedTime > '2026-01-01T00:00:00.000Z' OR (MetaData.LastUpdatedTime = '2026-01-01T00:00:00.000Z' AND Id > '123') ORDER BY MetaData.LastUpdatedTime ASC, Id ASC MAXRESULTS 50");
        });
    });
});
