import { TransformerPort, TransformationContext } from '@soopa/transformer';
import { Transformer } from '@soopa/transformer';
import type { NormalizedRecord, NormalizedEntityType } from '@soopa/piece-framework';

export interface RevenovaInput {
  entityType: string;
  data: Record<string, unknown>;
}

type TypeRule = { match: string; type: NormalizedEntityType; flags?: Record<string, boolean>; requiredFields?: string[] };

const ACCOUNT_TYPE_RULES: TypeRule[] = [
  { match: 'factor', type: 'TMS_FACTORING', requiredFields: ['name'] },
  { match: 'carrier', type: 'TMS_CARRIER', requiredFields: ['name'] },
  { match: 'customer', type: 'TMS_CUSTOMER', requiredFields: ['name'] },
  { match: 'vendor', type: 'TMS_VENDOR', requiredFields: ['name'] },
  { match: 'shipper', type: 'TMS_ADDRESS', flags: { isPickup: true, isDelivery: false } },
  { match: 'consignee', type: 'TMS_ADDRESS', flags: { isPickup: false, isDelivery: true } },
];

function resolveAccountType(rawTmsType?: string) {
  if (!rawTmsType) return null;
  const t = rawTmsType.toLowerCase();
  return ACCOUNT_TYPE_RULES.find((rule) => t.includes(rule.match)) || null;
}

const ACCOUNT_MAPPING = {
  displayName:       "name",
  tmsType:           "rtms__tms_type__c",
  tpSourceId:        "rtms__transportation_profile__c",
  billingStreet:     "billingstreet",
  billingCity:       "billingcity",
  billingState:      "billingstate",
  billingPostalCode: "billingpostalcode",
  billingCountry:    "billingcountry",
  phone:             "phone",
  fax:               "fax",
  email:             "email",
  isCarrier:         "akatia__carrier__c",
  isVendor:          "akatia__vendor__c",
  isBroker:          "akatia__broker__c",
};

export class AccountTransformer implements TransformerPort<RevenovaInput, NormalizedRecord | null> {
  private readonly mapper = new Transformer(ACCOUNT_MAPPING);

  public transform(input: RevenovaInput, context?: TransformationContext): NormalizedRecord | null {
    const data = input.data;
    const resolution = resolveAccountType(data.rtms__tms_type__c as string | undefined);
    if (!resolution) return null;

    // Declarative validation: drop record if any required field is missing or empty
    if (resolution.requiredFields) {
      for (const field of resolution.requiredFields) {
        const val = data[field];
        if (typeof val !== 'string' || val.trim() === '') return null;
      }
    }

    const mappedData = this.mapper.transform(data, context);
    
    if (resolution.flags) {
      Object.assign(mappedData, resolution.flags);
    }

    return {
      canonicalType: resolution.type,
      data: mappedData
    };
  }
}
