import { createJsonataNormalizer, JsonataMappingDictionary } from '@nexiom/piece-framework';

const metadataDictionary: JsonataMappingDictionary = {
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

export const upsertTMSObject = createJsonataNormalizer(metadataDictionary);