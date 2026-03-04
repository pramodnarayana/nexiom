import type { ObjectSchema } from './discovery-service.js';
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
        return 'Id';  // Last-resort append-only cursor
    }
}
