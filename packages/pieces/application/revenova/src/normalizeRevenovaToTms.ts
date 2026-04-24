import type { NormalizerFn, NormalizedEntityType } from '@nexiom/piece-framework';

// ---------------------------------------------------------------------------
// Revenova → TMS canonical normalizer
//
// Converts Salesforce/RTMS API field names into the TMS canonical data model.
// This is connector-specific: Revenova uses rtms__* namespace prefixes.
// McLeod would have its own normalizeMcLeodToTms.ts with different field names.
// ---------------------------------------------------------------------------

/**
 * Maps the Salesforce rtms__tms_type__c picklist value to a NormalizedEntityType.
 * Returns null for unrecognized values so the caller can skip normalization.
 * Also extracts pickup/delivery flags for TMS_ADDRESS routing.
 */
function resolveAccountCanonicalType(rawTmsType: unknown): {
    canonicalType: NormalizedEntityType | null;
    isPickup?: boolean;
    isDelivery?: boolean;
} {
    const t = typeof rawTmsType === 'string' ? rawTmsType.toLowerCase() : '';
    // Check more specific tokens first to prevent shadowing by generic tokens
    if (t.includes('factor'))     return { canonicalType: 'TMS_FACTORING' };
    if (t.includes('carrier'))    return { canonicalType: 'TMS_CARRIER' };
    if (t.includes('customer'))   return { canonicalType: 'TMS_CUSTOMER' };
    if (t.includes('vendor'))     return { canonicalType: 'TMS_VENDOR' };

    if (t.includes('shipper') || t.includes('consignee')) {
        return {
            canonicalType: 'TMS_ADDRESS',
            isPickup: t.includes('shipper'),
            isDelivery: t.includes('consignee'),
        };
    }

    // Unrecognized picklist value — log and return null to prevent invalid discriminator
    console.warn(`[normalizeRevenovaToTms] Unrecognized rtms__tms_type__c value: "${String(rawTmsType)}" — skipping normalization`);
    return { canonicalType: null };
}

/**
 * normalizeRevenovaToTms — Revenova's NormalizerFn for TMS entities.
 *
 * Registered as: registerNormalizer('salesforce', 'revenova', normalizeRevenovaToTms)
 *
 * Routes:
 *   sf_Account                     → TMS_CARRIER | TMS_VENDOR | TMS_CUSTOMER
 *                                    | TMS_FACTORING | TMS_ADDRESS
 *   rtms__TransportationProfile__c → TMS_TP
 *   rtms__Load__c                  → TMS_LOAD
 *
 * Field names in the returned data blob match the tms_* typed column names
 * in @nexiom/domain-tms, allowing the canonical writer to upsert directly.
 */
export const normalizeRevenovaToTms: NormalizerFn = ({ entityType, data }) => {

    // ── Salesforce Account ──────────────────────────────────────────────────
    if (entityType === 'sf_Account') {
        // First determine if this Account is routable to TMS, before validating fields
        const resolution = resolveAccountCanonicalType(data['rtms__tms_type__c']);
        const { canonicalType, isPickup, isDelivery } = resolution;

        // Short-circuit if the type is unrecognized — skip normalization for non-TMS accounts
        if (canonicalType === null) {
            return null;
        }

        // Validate TMS-routed accounts have required fields
        if (!data['name'] || typeof data['name'] !== 'string') {
            if (canonicalType !== 'TMS_ADDRESS') {
                // For non-ADDRESS entities, missing name is a critical error — drop the record
                console.warn(
                    `normalizeRevenovaToTms: sf_Account is missing required "name" field (entityType=${entityType}, canonicalType=${canonicalType}) — dropping record`
                );
                return null;
            }
            // For TMS_ADDRESS, warn but continue processing
            console.warn(
                `normalizeRevenovaToTms: sf_Account is missing required "name" field (entityType=${entityType}, canonicalType=${canonicalType})`
            );
        }
        if (!data['billingstreet'] && !data['billingcity'] && !data['billingstate']) {
            console.warn(
                `normalizeRevenovaToTms: sf_Account is missing address keys (entityType=${entityType}, canonicalType=${canonicalType}, expected at least one of: billingstreet, billingcity, billingstate)`
            );
        }

        const normalizedData: Record<string, unknown> = {
            displayName:       data['name'],
            tmsType:           data['rtms__tms_type__c'],
            // TP SF ID — FK link to tms_tp table
            tpSfId:            data['rtms__transportation_profile__c'],
            // Billing address → ShipAddr on QB Vendor
            billingStreet:     data['billingstreet'],
            billingCity:       data['billingcity'],
            billingState:      data['billingstate'],
            billingPostalCode: data['billingpostalcode'],
            billingCountry:    data['billingcountry'],
            // Contact
            phone:             data['phone'],
            fax:               data['fax'],
            email:             data['email'],
            // Type flags
            isCarrier:         data['akatia__carrier__c'],
            isVendor:          data['akatia__vendor__c'],
            isBroker:          data['akatia__broker__c'],
        };

        // Add pickup/delivery flags for TMS_ADDRESS routing
        if (canonicalType === 'TMS_ADDRESS') {
            if (isPickup !== undefined) {
                normalizedData.isPickup = isPickup;
            }
            if (isDelivery !== undefined) {
                normalizedData.isDelivery = isDelivery;
            }
        }

        return {
            canonicalType,
            data: normalizedData,
        };
    }

    // ── Transportation Profile ──────────────────────────────────────────────
    if (entityType === 'rtms__TransportationProfile__c') {
        return {
            canonicalType: 'TMS_TP',
            data: {
                mcNumber:            data['rtms__mc_number__c'],
                scac:                data['rtms__scac__c'],
                federalTaxId:        data['rtms__federal_tax_id__c'],
                usdot:               data['rtms__usdot_number__c'],
                // Remit-To Account SF ID — FK to tms_carrier or tms_factoring
                remitToSfId:         data['rtms__carrier_remit_to__c'],
                remitToOption:       data['rtms__remit_to_option__c'],
                carrierOperation:    data['rtms__carrier_operation__c'],
                agreementStatus:     data['rtms__agreement_status__c'],
                carrierReviewStatus: data['rtms__carrier_review_status__c'],
            },
        };
    }

    // ── Load ─────────────────────────────────────────────────────────────────
    // TMS_LOAD writer support does not yet exist — skip emitting normalized records
    // until tmsNormalizedWriter implements the TMS_LOAD branch.
    if (entityType === 'rtms__Load__c') {
        console.warn(
            `normalizeRevenovaToTms: rtms__Load__c is recognized but TMS_LOAD writer support is not yet implemented — skipping normalization`
        );
        return null;
    }

    return null;
};