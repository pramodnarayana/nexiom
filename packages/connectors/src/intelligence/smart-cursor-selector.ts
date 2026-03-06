import type { ObjectSchema } from './interfaces.js';
import type { ObjectHint } from './optimization-registry.js';

/** Default cursor preference order when no hint overrides. */
const DEFAULT_CURSOR_PRECEDENCE: string[] = [
    'SystemModstamp',
    'LastModifiedDate',
    'CreatedDate',
];

export class SmartCursorSelector {
    /**
     * Picks the best cursor field from the schema.
     * Respects the hint's cursorPrecedence list if provided.
     * Falls back to DEFAULT_CURSOR_PRECEDENCE, then 'Id'.
     */
    static pick(schema: ObjectSchema, hint?: ObjectHint): string {
        const precedence = hint?.cursorPrecedence ?? DEFAULT_CURSOR_PRECEDENCE;
        const fieldNames = new Set(schema.fields.map(f => f.name));

        for (const candidate of precedence) {
            if (fieldNames.has(candidate)) return candidate;
        }
        if (fieldNames.has('Id')) return 'Id';

        const idField = schema.fields.find(f => f.name.toLowerCase() === 'id' || f.type.toLowerCase() === 'id');
        if (idField) return idField.name;

        throw new Error(`Cannot determine a valid cursor field for object ${schema.objectName}. No timestamp or ID field found.`);
    }
}
