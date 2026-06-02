import type { NormalizerFn, NormalizedEntityType } from '@nexiom/piece-framework';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import jsonata from 'jsonata';

// ---------------------------------------------------------------------------
// Revenova → TMS canonical normalizer (GitOps Mappings Phase 1)
//
// Converts Salesforce/RTMS API field names into the TMS canonical data model
// using a dynamically loaded JSONata expression.
// ---------------------------------------------------------------------------

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Pre-compile the JSONata expression on module load.
// In the future, this will be fetched from MappingsService Redis cache.
const mappingFilePath = path.resolve(__dirname, '../mappings/normalizeRevenovaToTms.jsonata');
const expressionSource = fs.readFileSync(mappingFilePath, 'utf8');
const expression = jsonata(expressionSource);

/**
 * normalizeRevenovaToTms — Revenova's NormalizerFn for TMS entities.
 *
 * Registered as: registerNormalizer('salesforce', 'revenova', normalizeRevenovaToTms)
 */
export const normalizeRevenovaToTms: NormalizerFn = ({ entityType, data }) => {
    try {
        const result = expression.evaluate({ entityType, data });
        return result || null;
    } catch (err) {
        console.error(`[normalizeRevenovaToTms] JSONata evaluation failed:`, err);
        return null;
    }
};