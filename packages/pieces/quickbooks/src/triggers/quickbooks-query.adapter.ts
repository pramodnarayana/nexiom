import type { QuerySpec } from '@nexiom/connections/intelligence';

export class QuickBooksQueryAdapter {
    /**
     * Builds a QuickBooks SQL query string.
     */
    static buildQBOQuery(entityType: string, spec: Omit<QuerySpec, 'autoJoins'>): string {
        if (!/^[a-zA-Z0-9]+$/.test(entityType)) {
            throw new Error(`Invalid QBO entity type: ${entityType}`);
        }
        if (!/^[-a-zA-Z0-9_:.+ ]+$/.test(spec.cursorValue)) {
            throw new Error(`Invalid cursor format: ${spec.cursorValue}`);
        }

        let query = `SELECT * FROM ${entityType} WHERE ${spec.cursorField} > '${spec.cursorValue}' ORDER BY ${spec.cursorField} ASC`;
        if (spec.limit !== 0) {
            query += ` MAXRESULTS ${spec.limit ?? 100}`;
        }
        return query;
    }
}
