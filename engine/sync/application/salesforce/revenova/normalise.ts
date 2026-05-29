import type { NormalizedEntityType } from '@nexiom/piece-framework';

type NormalizeHandler = (data: Record<string, unknown>) => { canonicalType: NormalizedEntityType; data: Record<string, unknown> } | null;

const normalizeAccount: NormalizeHandler = (data) => {
    const tmsType = data['rtms__tms_type__c'] as string | undefined;
    const lowerType = tmsType?.toLowerCase() || '';
    
    let canonicalType: NormalizedEntityType = 'TMS_CARRIER';
    if (lowerType.includes('factor')) {
        canonicalType = 'TMS_FACTORING';
    } else if (lowerType.includes('vendor')) {
        canonicalType = 'TMS_VENDOR';
    } else if (lowerType.includes('customer')) {
        canonicalType = 'TMS_CUSTOMER';
    } else if (!lowerType.includes('carrier')) {
        return null;
    }

    return {
        canonicalType,
        data: {
            sourceId: data['id'],
            displayName: data['name'],
            tmsType: tmsType || 'TMS_CARRIER',
            tpSourceId: data['rtms__transportation_profile__c'],
            billingStreet: data['billingstreet'],
            billingCity: data['billingcity'],
            billingState: data['billingstate'],
            billingPostalCode: data['billingpostalcode'],
            billingCountry: data['billingcountry'],
            phone: data['phone'],
            fax: data['fax'],
        }
    };
};

const normalizeTransportationProfile: NormalizeHandler = (data) => {
    return {
        canonicalType: 'TMS_TP',
        data: {
            sourceId: data['id'],
            mcNumber: data['rtms__mc_number__c'],
            scac: data['rtms__scac__c'],
            federalTaxId: data['rtms__federal_tax_id__c'],
            usdot: data['rtms__us_dot_number__c'],
            carrierOperation: data['rtms__carrier_operation__c'],
            agreementStatus: data['rtms__agreement_status__c'],
            remitToOption: data['rtms__remit_to_option__c'],
            remitToSourceId: data['rtms__remit_to_account__c'],
        }
    };
};

// Handlers dictionary for O(1) lookup and clean scaling
const handlers: Record<string, NormalizeHandler> = {
    'Account': normalizeAccount,
    'TransportationProfile__c': normalizeTransportationProfile,
    'rtms__TransportationProfile__c': normalizeTransportationProfile,
};

export const NormaliseRevenovaObject = async (
    replica: { entityType: string; data: Record<string, unknown> }
): Promise<{ canonicalType: NormalizedEntityType; data: Record<string, unknown> } | null> => {
    const handler = handlers[replica.entityType];
    
    if (handler) {
        return handler(replica.data);
    }

    // Unmapped types gracefully fall back to RAW mapping
    return null;
};
