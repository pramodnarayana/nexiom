import {
    type IQueryAdapter,
    type ObjectSchema,
    type QuerySpec
} from '@nexiom/connectors/intelligence';
import { assertSafeSalesforceObject } from '../trigger/salesforce-polling.helper.js';

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
        const whereClause = this.buildWhereClause(schema, spec);

        let query = `SELECT ${selectClause} FROM ${spec.objectName} WHERE ${whereClause} ORDER BY ${spec.cursorField} ASC`;
        if (spec.tieBreakerField) {
            query += `, ${spec.tieBreakerField} ASC`;
        }

        const safeLimit = this.calculateLimit(spec.limit);

        if (!spec.omitLimit && safeLimit !== 0) {
            query += ` LIMIT ${safeLimit}`;
        }

        return query;
    }

    buildCountQuery(schema: ObjectSchema, spec: QuerySpec): string {
        assertSafeSalesforceObject(spec.objectName);
        this.validateCursor(spec.cursorValue);

        const whereClause = this.buildWhereClause(schema, spec);

        return `SELECT COUNT() FROM ${spec.objectName} WHERE ${whereClause}`;
    }

    private buildWhereClause(schema: ObjectSchema, spec: QuerySpec): string {
        const cursorFieldDef = schema.fields.find(f => f.name === spec.cursorField);
        if (!cursorFieldDef) {
            throw new Error(`Invalid cursorField: '${spec.cursorField}' not found on object '${spec.objectName}'`);
        }
        const isStringType = ['string', 'id', 'reference'].includes(cursorFieldDef.type.toLowerCase());
        const formattedCursorValue = isStringType ? `'${spec.cursorValue}'` : spec.cursorValue;

        let tbFormatted: string | null = null;

        if (spec.tieBreakerField && spec.tieBreakerValue) {
            const tbFieldDef = schema.fields.find(f => f.name === spec.tieBreakerField);
            if (!tbFieldDef) {
                throw new Error(`Invalid tieBreakerField: '${spec.tieBreakerField}' not found on object '${spec.objectName}'`);
            }
            this.validateCursor(spec.tieBreakerValue);
            const isTbStringType = ['string', 'id', 'reference'].includes(tbFieldDef.type.toLowerCase());
            tbFormatted = isTbStringType ? `'${spec.tieBreakerValue}'` : spec.tieBreakerValue;
        } else if (spec.tieBreakerField && !spec.tieBreakerValue) {
            // tieBreakerField was requested but no value is available yet (e.g. first poll).
            // Fall back to cursor-only pagination so the caller is aware.
            console.warn(
                `[SalesforceQueryAdapter] tieBreakerField '${spec.tieBreakerField}' is set ` +
                `but tieBreakerValue is missing for object '${spec.objectName}'. ` +
                `Falling back to cursor-only pagination.`
            );
        }

        if (spec.tieBreakerField && tbFormatted) {
            return `(${spec.cursorField} > ${formattedCursorValue} OR (${spec.cursorField} = ${formattedCursorValue} AND ${spec.tieBreakerField} > ${tbFormatted}))`;
        }
        return `${spec.cursorField} > ${formattedCursorValue}`;
    }

    private calculateLimit(limit: number | undefined): number {
        if (limit === undefined) return 200;
        if (limit === 0) return 0;
        const parsed = Number(limit);
        if (!Number.isFinite(parsed) || parsed < 0 || !Number.isInteger(parsed)) {
            throw new Error(`Invalid limit: ${limit} — must be an integer >= 0`);
        }
        return parsed;
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
