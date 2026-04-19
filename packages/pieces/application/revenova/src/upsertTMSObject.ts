import type { NormalizerFn, CanonicalType } from '@nexiom/piece-framework';

// In an enterprise system, this mapping dictionary is often stored in the database
// and retrieved via cache. For this isolated application code shard, we construct
// a local fallback dictionary covering the schema mapping definitions.
const metadataDictionary: Record<string, { type: CanonicalType; fields: Record<string, string> }> = {
    'sf_Account': {
        type: 'TMS_CARRIER',
        fields: {
            'displayName': 'name_',
            'currency': 'CurrencyIsoCode',
            'status': 'Status__c'
        }
    },
    'rtms__Load__c': {
        type: 'TMS_LOAD',
        fields: {
            'displayName': 'name_',
            'pickupDate': 'rtms__Pickup_Date__c'
        }
    }
};

export const upsertTMSObject: NormalizerFn = (replica) => {
    const meta = metadataDictionary[replica.entityType];

    if (!meta) return null; // No canonical mapping defined, platform defaults to 'RAW'

    const canonicalFields: Record<string, unknown> = {};

    // Generic loop strictly evaluated on the metadata dictionary without massive if-blocks
    for (const [targetCanonicalKey, sourceVendorKey] of Object.entries(meta.fields)) {
        canonicalFields[targetCanonicalKey] = replica.data[sourceVendorKey];
    }

    // sourceId should be null when neither Id nor id exists, so distinct vendor
    // records without Id/id don't collapse into a single 'unknown' entry
    const sourceId = replica.data.Id ?? replica.data.id ?? null;

    return {
        canonicalType: meta.type,
        sourceId: sourceId !== null ? String(sourceId) : undefined,
        data: canonicalFields,
    };
};