import type { NormalizerFn, NormalizedRecord } from '@soopa/piece-framework';

import jsonata from 'jsonata';
import type { Expression } from 'jsonata';
const normalizeRevenovaToTmsMapping = `
(
    $resolveAccountCanonicalType := function($rawTmsType) {
        $rawTmsType ? (
            $t := $lowercase($rawTmsType);
            $contains($t, 'factor') ? { "canonicalType": "TMS_FACTORING" } :
            $contains($t, 'carrier') ? { "canonicalType": "TMS_CARRIER" } :
            $contains($t, 'customer') ? { "canonicalType": "TMS_CUSTOMER" } :
            $contains($t, 'vendor') ? { "canonicalType": "TMS_VENDOR" } :
            ($contains($t, 'shipper') or $contains($t, 'consignee')) ? {
                "canonicalType": "TMS_ADDRESS",
                "isPickup": $contains($t, 'shipper'),
                "isDelivery": $contains($t, 'consignee')
            } : { "canonicalType": null }
        ) : { "canonicalType": null }
    };

    entityType = 'Account' ? (
        $resolution := $resolveAccountCanonicalType(data.rtms__tms_type__c);
        $resolution.canonicalType = null ? null : (
            /* Warning logging not directly supported in standard JSONata, skipped */
            $resolution.canonicalType != 'TMS_ADDRESS' and ($not($exists(data.name)) or data.name = null or $trim(data.name) = "") ? null : {
                "canonicalType": $resolution.canonicalType,
                "data": {
                    "displayName":       data.name,
                    "tmsType":           data.rtms__tms_type__c,
                    "tpSourceId":        data.rtms__transportation_profile__c,
                    "billingStreet":     data.billingstreet,
                    "billingCity":       data.billingcity,
                    "billingState":      data.billingstate,
                    "billingPostalCode": data.billingpostalcode,
                    "billingCountry":    data.billingcountry,
                    "phone":             data.phone,
                    "fax":               data.fax,
                    "email":             data.email,
                    "isCarrier":         data.akatia__carrier__c,
                    "isVendor":          data.akatia__vendor__c,
                    "isBroker":          data.akatia__broker__c,
                    "isPickup":          $resolution.isPickup,
                    "isDelivery":        $resolution.isDelivery
                }
            }
        )
    ) : entityType = 'rtms__TransportationProfile__c' ? {
        "canonicalType": "TMS_TP",
        "data": {
            "invoiceTerms":        data.rtms__invoice_terms__c,
            "paymentTerms":        data.rtms__payment_terms__c,
            "carrierPaymentTerms": data.rtms__carrier_payment_terms__c,
            "carrierRemitTo":      data.rtms__carrier_remit_to__c,
            "companyType":         data.rtms__company_type__c,
            "creditLimit":         data.rtms__credit_limit__c,
            "remitToOption":       data.rtms__remit_to_option__c,
            "mcNumber":            data.rtms__mc_number__c,
            "stateDotNumber":      data.rtms__state_dot_number__c,
            "usDotNumber":         data.rtms__usdot_number__c
        }
    } : null
)
`;

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
export const normalizeRevenovaToTms: NormalizerFn = async ({ entityType, data }) => {
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
        const result = await expression.evaluate({ entityType, data });

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