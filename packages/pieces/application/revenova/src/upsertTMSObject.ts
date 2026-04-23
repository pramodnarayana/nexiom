import { createJsonataNormalizer } from '@nexiom/piece-framework';
import type { JsonataMappingDictionary } from '@nexiom/piece-framework';

const metadataDictionary: JsonataMappingDictionary = {
    'sf_Account': {
        type: 'TMS_CARRIER',
        mappingExpr: `{
            "displayName": name,
            "city": billingcity,
            "state": billingstate,
            "country": billingcountry,
            "postalCode": billingpostalcode,
            "street": billingstreet,
            "tmsType": rtms__tms_type__c,
            "isCarrier": akatia__carrier__c,
            "isBroker": akatia__broker__c,
            "isVendor": akatia__vendor__c
        }`
    },
    'rtms__Load__c': {
        type: 'TMS_LOAD',
        mappingExpr: `{
            "displayName": name,
            "pickupDate": rtms__pickup_date__c
        }`
    }
};

export const upsertTMSObject = createJsonataNormalizer(metadataDictionary);