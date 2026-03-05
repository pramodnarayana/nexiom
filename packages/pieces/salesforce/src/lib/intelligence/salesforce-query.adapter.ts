import {
    type IQueryAdapter,
    type ObjectSchema,
    type QuerySpec,
    assertSafeSalesforceObject
} from '@nexiom/connections/intelligence';

export class SalesforceQueryAdapter implements IQueryAdapter {
    buildQuery(schema: ObjectSchema, spec: QuerySpec): string {
        assertSafeSalesforceObject(spec.objectName);
        this.validateCursor(spec.cursorValue);

        const discoveredFieldNames = new Set(schema.fields.map(f => f.name));
        const selectedFields = this.selectFields(schema, spec, discoveredFieldNames);

        // Always include Id and cursor
        selectedFields.add('Id');
        if (discoveredFieldNames.has(spec.cursorField)) {
            selectedFields.add(spec.cursorField);
        }

        const columns = Array.from(selectedFields);
        this.appendAutoJoins(schema, spec, columns);

        const selectClause = columns.join(', ');

        const cursorFieldDef = schema.fields.find(f => f.name === spec.cursorField);
        if (!cursorFieldDef) {
            throw new Error(`Invalid cursorField: '${spec.cursorField}' not found on object '${spec.objectName}'`);
        }
        const isStringType = ['string', 'id', 'reference'].includes(cursorFieldDef.type.toLowerCase());
        const formattedCursorValue = isStringType ? `'${spec.cursorValue}'` : spec.cursorValue;

        let query = `SELECT ${selectClause} FROM ${spec.objectName} WHERE ${spec.cursorField} > ${formattedCursorValue} ORDER BY ${spec.cursorField} ASC`;

        let safeLimit = 200;
        if (spec.limit !== undefined) {
            if (spec.limit === 0) {
                safeLimit = 0;
            } else {
                const parsed = Number(spec.limit);
                if (!Number.isFinite(parsed) || parsed < 0) {
                    throw new Error(`Invalid limit: ${spec.limit}`);
                }
                safeLimit = Math.max(1, Math.floor(parsed));
            }
        }

        if (!spec.omitLimit && safeLimit !== 0) {
            query += ` LIMIT ${safeLimit}`;
        }

        return query;
    }

    buildCountQuery(schema: ObjectSchema, spec: QuerySpec): string {
        assertSafeSalesforceObject(spec.objectName);
        this.validateCursor(spec.cursorValue);

        const cursorFieldDef = schema.fields.find(f => f.name === spec.cursorField);
        if (!cursorFieldDef) {
            throw new Error(`Invalid cursorField: '${spec.cursorField}' not found on object '${spec.objectName}'`);
        }
        const isStringType = ['string', 'id', 'reference'].includes(cursorFieldDef.type.toLowerCase());
        const formattedCursorValue = isStringType ? `'${spec.cursorValue}'` : spec.cursorValue;

        return `SELECT COUNT() FROM ${spec.objectName} WHERE ${spec.cursorField} > ${formattedCursorValue}`;
    }

    private validateCursor(cursorValue: string): void {
        if (!/^[-a-zA-Z0-9_:.+ ]+$/.test(cursorValue)) {
            throw new Error(`Invalid cursor format: ${cursorValue}`);
        }
    }

    private selectFields(schema: ObjectSchema, spec: QuerySpec, discoveredFieldNames: Set<string>): Set<string> {
        const selectedFields = new Set<string>();
        if (spec.requestedFields) {
            for (const f of spec.requestedFields) {
                if (discoveredFieldNames.has(f)) {
                    selectedFields.add(f);
                }
            }
        } else {
            for (const f of schema.fields) {
                if (f.filterable && f.type !== 'base64') {
                    selectedFields.add(f.name);
                }
            }
        }
        return selectedFields;
    }

    private appendAutoJoins(schema: ObjectSchema, spec: QuerySpec, columns: string[]): void {
        if (!spec.autoJoins || spec.autoJoins.length === 0) return;

        const validRelationships = new Set(schema.childRelationships.map(r => r.relationshipName));
        for (const join of spec.autoJoins) {
            if (validRelationships.has(join)) {
                columns.push(`(SELECT Id FROM ${join})`);
            }
        }
    }
}
