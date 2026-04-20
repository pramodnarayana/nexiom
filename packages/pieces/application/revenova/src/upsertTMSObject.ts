import jsonata from 'jsonata';
import type { NormalizerFn, CanonicalType } from '@nexiom/piece-framework';

// In an enterprise system, this mapping dictionary is often stored in the database
// and retrieved via cache. For this isolated application code shard, we construct
// a local fallback dictionary using JSONata expressions.
const metadataDictionary: Record<string, { type: CanonicalType; mappingExpr: string }> = {
    'sf_Account': {
        type: 'TMS_CARRIER',
        mappingExpr: `{
            "displayName": name_,
            "currency": CurrencyIsoCode,
            "status": Status__c
        }`
    },
    'rtms__Load__c': {
        type: 'TMS_LOAD',
        mappingExpr: `{
            "displayName": name_,
            "pickupDate": rtms__Pickup_Date__c
        }`
    }
};

// GLOBAL CACHE: Survives across SQS message executions within the same worker isolate.
// This is critical for high-throughput CDC processing so we don't compile ASTs per-event.
const compiledMappings = new Map<string, jsonata.Expression>();

export const upsertTMSObject: NormalizerFn = async (replica) => {
    const meta = metadataDictionary[replica.entityType];

    if (!meta) return null; // No canonical mapping defined, platform defaults to 'RAW'

    // 1. AST CACHE LOOKUP
    let expression = compiledMappings.get(replica.entityType);

    // 2. LAZY COMPILATION
    if (!expression) {
        expression = jsonata(meta.mappingExpr);
        compiledMappings.set(replica.entityType, expression); // Cache the compiled AST
    }

    // 3. FAST EVALUATION
    // @ts-expect-error JSONata evaluate returns any, we treat it as Record<string, unknown>
    const canonicalFields = Object.assign({}, await expression.evaluate(replica.data));

    // sourceId should be null when neither Id nor id exists, so distinct vendor
    // records without Id/id don't collapse into a single 'unknown' entry
    const sourceId = replica.data.Id ?? replica.data.id ?? null;

    return {
        canonicalType: meta.type,
        sourceId: sourceId !== null ? String(sourceId) : undefined,
        data: canonicalFields,
    };
};