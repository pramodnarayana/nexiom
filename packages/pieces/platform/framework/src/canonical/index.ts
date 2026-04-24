/**
 * Discriminator for Nexiom's normalized entity model.
 * Used as the routing key in the normalization pipeline:
 *   NormalizationService → typed tms_* / crm_* / accounting_* tables
 *
 * Naming: "NormalizedEntityType" — consistent with NormalizationService,
 * normalized_entity table, and NormalizedRecord throughout the platform.
 */
export type NormalizedEntityType =
  | 'TMS_LOAD'
  | 'TMS_INVOICE'
  | 'TMS_CARRIER'
  | 'TMS_VENDOR'
  | 'TMS_CUSTOMER'
  | 'TMS_FACTORING'
  | 'TMS_ADDRESS'
  | 'TMS_TP'
  | 'TMS_LOCATION'
  | 'CRM_CONTACT'
  | 'CRM_ACCOUNT'
  | 'CRM_OPPORTUNITY'
  | 'ACCOUNTING_INVOICE'
  | 'ACCOUNTING_PAYMENT';

/** @deprecated Use NormalizedEntityType instead */
export type CanonicalType = NormalizedEntityType;

/** Output of the NormalizerFn — a record in Nexiom's normalized entity model. */
export interface NormalizedRecord {
  /** Discriminates the entity — aligns with tms_*, crm_*, accounting_* table routing. */
  canonicalType: NormalizedEntityType;
  data: Record<string, unknown>;
  sourceId?: string;
  normalizedAt?: string;
}

/** Vendor API response from piece.executeAction(). */
export interface VendorResponse {
  /** HTTP status code from the vendor. */
  statusCode: number;
  /** Parsed response body. */
  body: Record<string, unknown>;
  /**
   * Optional piece-layer retry opt-in.
   * Set to `true` to signal DeliveryService that this response should be
   * retried without the piece needing to throw a RetryableException.
   */
  retry?: boolean;
}
