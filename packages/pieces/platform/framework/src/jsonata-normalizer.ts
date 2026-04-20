import jsonata from 'jsonata';
import type { CanonicalType } from './canonical/index.js';
import type { NormalizerFn } from './normalizer.js';

export type JsonataMappingDictionary = Record<
  string, // entityType (e.g. 'sf_Account')
  {
    type: CanonicalType;
    mappingExpr: string;
  }
>;

/**
 * Creates a highly performant NormalizerFn backed by a cached JSONata execution engine.
 *
 * It takes a dictionary of entityTypes to JSONata expression strings.
 * It compiles the AST the first time it encounters an entityType and caches it in memory,
 * ensuring zero compilation overhead during high-throughput CDC processing.
 *
 * @param mappingDictionary A static dictionary dictating how vendor payloads map to canonical formats via JSONata expressions.
 * @returns A NormalizerFn that can be registered with the PieceRegistry or getNormalizer.
 */
export function createJsonataNormalizer(mappingDictionary: JsonataMappingDictionary): NormalizerFn {
  // GLOBAL CACHE per piece registration:
  // Survives across SQS message executions within the same worker isolate.
  const compiledMappings = new Map<string, jsonata.Expression>();

  return async (replica) => {
    const meta = mappingDictionary[replica.entityType];

    if (!meta) return null; // No canonical mapping defined, platform defaults to 'RAW'

    // 1. AST CACHE LOOKUP
    let expression = compiledMappings.get(replica.entityType);

    // 2. LAZY COMPILATION
    if (!expression) {
      expression = jsonata(meta.mappingExpr);
      compiledMappings.set(replica.entityType, expression); // Cache the compiled AST
    }

    // 3. FAST EVALUATION
    const evalResult = await expression.evaluate(replica.data);
    if (evalResult === null) {
      throw new Error(`JSONata normalization failed: expected a plain object but got null for entityType ${replica.entityType}`);
    }
    if (evalResult === undefined) {
      throw new Error(`JSONata normalization failed: expected a plain object but got undefined for entityType ${replica.entityType}`);
    }
    if (typeof evalResult !== 'object' || Array.isArray(evalResult)) {
      throw new Error(`JSONata normalization failed: expected a plain object but got ${Array.isArray(evalResult) ? 'Array' : typeof evalResult} for entityType ${replica.entityType}`);
    }

    // Safe copy: filter out dangerous keys to prevent prototype pollution
    const unsafeKeys = new Set(['__proto__', 'constructor', 'prototype']);
    const canonicalFields = Object.create(null);
    for (const key of Object.keys(evalResult)) {
      if (!unsafeKeys.has(key)) {
        canonicalFields[key] = evalResult[key];
      }
    }

    // sourceId should be undefined when neither Id nor id exists or when they contain
    // only whitespace, so distinct vendor records without valid IDs don't collapse
    const rawSourceId = replica.data.Id ?? replica.data.id ?? null;
    const trimmedSourceId = rawSourceId !== null ? String(rawSourceId).trim() : '';
    const sourceId = trimmedSourceId !== '' ? trimmedSourceId : undefined;

    return {
      canonicalType: meta.type,
      sourceId,
      data: canonicalFields as Record<string, unknown>,
    };
  };
}