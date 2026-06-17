import type { NormalizerFn, NormalizedRecord } from '@soopa/piece-framework';

import jsonata from 'jsonata';
import type { Expression } from 'jsonata';
import { normalizeRevenovaToTmsMapping } from './normalizeRevenovaToTmsMapping.js';

// ---------------------------------------------------------------------------
// Revenova → TMS canonical normalizer (GitOps Mappings Phase 1)
//
// Converts Salesforce/RTMS API field names into the TMS canonical data model
// using a dynamically loaded JSONata expression.
// ---------------------------------------------------------------------------

// Pre-compile the JSONata expression on module load.
// In the future, this will be fetched from MappingsService Redis cache.
let expression: Expression | null = null;
let compilationError: Error | null = null;

try {
    expression = jsonata(normalizeRevenovaToTmsMapping);
} catch (err) {
    compilationError = err instanceof Error ? err : new Error(String(err));
    console.error('[normalizeRevenovaToTms] Failed to load or compile JSONata mapping:', compilationError);
}

/**
 * Type guard to validate that a value conforms to NormalizedRecord shape.
 */
function isValidNormalizedRecord(value: unknown): value is NormalizedRecord {
    if (!value || typeof value !== 'object') {
        return false;
    }
    const record = value as Record<string, unknown>;

    // Check for canonicalType (or canonical_type for backward compat)
    const canonicalType = record.canonicalType ?? record.canonical_type;
    if (typeof canonicalType !== 'string' || canonicalType.length === 0) {
        return false;
    }

    // Check for data field
    if (!record.data || typeof record.data !== 'object' || Array.isArray(record.data)) {
        return false;
    }

    return true;
}

/**
 * normalizeRevenovaToTms — Revenova's NormalizerFn for TMS entities.
 *
 * Registered as: registerNormalizer('salesforce', 'revenova', normalizeRevenovaToTms)
 */
export const normalizeRevenovaToTms: NormalizerFn = ({ entityType, data }) => {
    // Check if expression was successfully compiled at module load
    if (!expression) {
        console.error(
            '[normalizeRevenovaToTms] JSONata expression not available. ' +
            'Compilation failed at module load.',
            compilationError
        );
        return null;
    }

    try {
        const result = expression.evaluate({ entityType, data });

        // Handle null/undefined explicitly (Issue 5: fix falsy coalescing)
        if (result === null || result === undefined) {
            return null;
        }

        // Validate the result against NormalizedRecord shape (Issue 4)
        if (!isValidNormalizedRecord(result)) {
            console.error(
                '[normalizeRevenovaToTms] JSONata result does not match NormalizedRecord shape. ' +
                'Expected object with canonicalType (string) and data (object). ' +
                'Received:',
                result
            );
            return null;
        }

        return result as NormalizedRecord;
    } catch (err) {
        console.error(`[normalizeRevenovaToTms] JSONata evaluation failed:`, err);
        return null;
    }
};