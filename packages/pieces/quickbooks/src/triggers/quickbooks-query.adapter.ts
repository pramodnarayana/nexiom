import type { QuerySpec } from '@nexiom/connections/intelligence';

export class QuickBooksQueryAdapter {
    /**
     * Builds a QuickBooks SQL query string.
     */
    static buildQBOQuery(entityType: string, spec: Omit<QuerySpec, 'autoJoins'>): string {
        if (!/^[a-zA-Z0-9]+$/.test(entityType)) {
            throw new Error(`Invalid QBO entity type: ${entityType}`);
        }
        if (!/^[a-zA-Z0-9_.:]+$/.test(spec.cursorField)) {
            throw new Error(`Invalid cursorField: ${spec.cursorField}`);
        }
        if (!/^[-a-zA-Z0-9_:.+ ]+$/.test(spec.cursorValue)) {
            throw new Error(`Invalid cursor format: ${spec.cursorValue}`);
        }

        let safeLimit = 100;
        if (spec.limit !== undefined) {
            if (spec.limit === 0) {
                safeLimit = 0;
            } else {
                const parsed = Number(spec.limit);
                if (Number.isNaN(parsed) || parsed < 0) {
                    throw new Error(`Invalid limit: ${spec.limit}`);
                }
                safeLimit = Math.min(Math.floor(parsed), 1000);
            }
        }

        let query = `SELECT * FROM ${entityType} WHERE ${spec.cursorField} > '${spec.cursorValue}' ORDER BY ${spec.cursorField} ASC`;
        if (safeLimit !== 0) {
            query += ` MAXRESULTS ${safeLimit}`;
        }
        return query;
    }
}
