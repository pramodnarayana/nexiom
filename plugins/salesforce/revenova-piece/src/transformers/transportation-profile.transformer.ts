import { TransformerPort, TransformationContext } from '@soopa/transformer';
import { Transformer } from '@soopa/transformer';
import type { NormalizedRecord } from '@soopa/piece-framework';

export interface RevenovaInput {
  entityType: string;
  data: Record<string, unknown>;
}

const TP_MAPPING = {
  invoiceTerms:        "rtms__invoice_terms__c",
  paymentTerms:        "rtms__payment_terms__c",
  carrierPaymentTerms: "rtms__carrier_payment_terms__c",
  carrierRemitTo:      "rtms__carrier_remit_to__c",
  companyType:         "rtms__company_type__c",
  creditLimit:         "rtms__credit_limit__c",
  remitToOption:       "rtms__remit_to_option__c",
  mcNumber:            "rtms__mc_number__c",
  stateDotNumber:      "rtms__state_dot_number__c",
  usDotNumber:         "rtms__usdot_number__c",
};

export class TransportationProfileTransformer implements TransformerPort<RevenovaInput, NormalizedRecord | null> {
  private readonly mapper = new Transformer(TP_MAPPING);

  public transform(input: RevenovaInput, context?: TransformationContext): NormalizedRecord | null {
    return {
      canonicalType: 'TMS_TP',
      data: this.mapper.transform(input.data, context)
    };
  }
}
