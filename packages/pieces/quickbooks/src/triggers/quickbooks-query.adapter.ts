export type QBOQuerySpec = {
    cursorField: string;
    cursorValue: string;
    cursorIdField?: string;
    cursorIdValue?: string;
    limit?: number | string;
};

export class QuickBooksQueryAdapter {
    /**
     * Builds a QuickBooks SQL query string.
     */
    static buildQBOQuery(entityType: string, spec: QBOQuerySpec): string {
        QuickBooksQueryAdapter.validateInputs(entityType, spec);
        const safeLimit = QuickBooksQueryAdapter.parseLimit(spec.limit);

        let query = '';
        if (spec.cursorIdField && spec.cursorIdValue) {
            query = `SELECT * FROM ${entityType} WHERE ${spec.cursorField} > '${spec.cursorValue}' OR (${spec.cursorField} = '${spec.cursorValue}' AND ${spec.cursorIdField} > '${spec.cursorIdValue}') ORDER BY ${spec.cursorField} ASC, ${spec.cursorIdField} ASC`;
        } else {
            query = `SELECT * FROM ${entityType} WHERE ${spec.cursorField} > '${spec.cursorValue}' ORDER BY ${spec.cursorField} ASC`;
        }

        if (safeLimit !== 0) {
            query += ` MAXRESULTS ${safeLimit}`;
        }
        return query;
    }

    private static validateInputs(entityType: string, spec: QBOQuerySpec): void {
        if (!/^[a-zA-Z0-9]+$/.test(entityType)) {
            throw new Error(`Invalid QBO entity type: ${entityType}`);
        }
        if (!/^[a-zA-Z0-9_.:]+$/.test(spec.cursorField)) {
            throw new Error(`Invalid cursorField: ${spec.cursorField}`);
        }
        if (!/^[-a-zA-Z0-9_:.+ ]+$/.test(spec.cursorValue)) {
            throw new Error(`Invalid cursor format: ${spec.cursorValue}`);
        }
        if (spec.cursorIdField && !spec.cursorIdValue) {
            throw new Error(`Both cursorIdField and cursorIdValue must be provided together. Missing cursorIdValue for cursorIdField: ${spec.cursorIdField}`);
        }
        if (!spec.cursorIdField && spec.cursorIdValue) {
            throw new Error(`Both cursorIdField and cursorIdValue must be provided together. Missing cursorIdField for cursorIdValue: ${spec.cursorIdValue}`);
        }

        if (spec.cursorIdField && !/^[a-zA-Z0-9_.:]+$/.test(spec.cursorIdField)) {
            throw new Error(`Invalid cursorIdField: ${spec.cursorIdField}`);
        }
        if (spec.cursorIdValue && !/^[-a-zA-Z0-9_:.+ ]+$/.test(spec.cursorIdValue)) {
            throw new Error(`Invalid cursor format: ${spec.cursorIdValue}`);
        }
    }

    private static parseLimit(limit?: number | string): number {
        if (limit === undefined) return 100;
        if (limit === 0) return 0;

        if (typeof limit === 'string' && limit.trim() === '') {
            return 100;
        }

        const parsed = Number(limit);
        if (Number.isNaN(parsed) || parsed < 0) {
            throw new Error(`Invalid limit: ${limit}`);
        }
        if (!Number.isInteger(parsed)) {
            throw new TypeError(`Fractional limit not allowed: ${limit}`);
        }
        return Math.min(parsed, 1000);
    }
}
