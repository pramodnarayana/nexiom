import { assertSafeSalesforceObject } from '../apps/salesforce/triggers/salesforce-polling.helper.js';
import type { ObjectSchema } from './discovery-service.js';

export interface QuerySpec {
    objectName: string;
    cursorField: string;
    cursorValue: string;      // ISO timestamp or ID
    requestedFields?: string[]; // From user's mapping UI; undefined = all filterable fields
    autoJoins?: string[];     // Child relationship names from hint
    limit?: number;           // Default 200; set to 0 for Bulk path
}

export class DynamicQueryBuilder {
    /**
     * Builds a SOQL string from the QuerySpec.
     * Field list is the INTERSECTION of requestedFields and discoveredFields
     * so we never SELECT fields that don't exist.
     */
    static buildSOQL(schema: ObjectSchema, spec: QuerySpec): string {
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
        let query = `SELECT ${selectClause} FROM ${spec.objectName} WHERE ${spec.cursorField} > ${spec.cursorValue} ORDER BY ${spec.cursorField} ASC`;

        if (spec.limit !== 0) {
            query += ` LIMIT ${spec.limit ?? 200}`;
        }

        return query;
    }

    private static validateCursor(cursorValue: string): void {
        if (!/^[\w\-:.TZ+]+$/.test(cursorValue)) {
            throw new Error(`Invalid cursor format: ${cursorValue}`);
        }
    }

    private static selectFields(schema: ObjectSchema, spec: QuerySpec, discoveredFieldNames: Set<string>): Set<string> {
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

    private static appendAutoJoins(schema: ObjectSchema, spec: QuerySpec, columns: string[]): void {
        if (!spec.autoJoins || spec.autoJoins.length === 0) return;

        const validRelationships = new Set(schema.childRelationships.map(r => r.relationshipName));
        for (const join of spec.autoJoins) {
            if (validRelationships.has(join)) {
                columns.push(`(SELECT Id FROM ${join})`);
            }
        }
    }

    /**
     * Builds a QuickBooks SQL query string.
     */
    static buildQBOQuery(entityType: string, spec: Omit<QuerySpec, 'autoJoins'>): string {
        if (!/^\w+$/.test(entityType)) {
            throw new Error(`Invalid QBO entity type: ${entityType}`);
        }
        if (!/^[\w\-:.TZ+]+$/.test(spec.cursorValue)) {
            throw new Error(`Invalid cursor format: ${spec.cursorValue}`);
        }

        let query = `SELECT * FROM ${entityType} WHERE ${spec.cursorField} > '${spec.cursorValue}' ORDER BY ${spec.cursorField} ASC`;
        if (spec.limit !== 0) {
            query += ` MAXRESULTS ${spec.limit ?? 100}`;
        }
        return query;
    }
}
