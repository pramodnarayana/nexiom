/**
 * The canonical type discriminator for Nexiom's normalized entity model.
 * Add new types as integrations expand.
 */
export type CanonicalType =
  | 'TMS_LOAD'
  | 'TMS_INVOICE'
  | 'TMS_CARRIER'
  | 'TMS_LOCATION'
  | 'CRM_CONTACT'
  | 'CRM_ACCOUNT'
  | 'CRM_OPPORTUNITY'
  | 'ACCOUNTING_INVOICE'
  | 'ACCOUNTING_PAYMENT';

/** Output of piece.normalize() — a record in Nexiom's canonical model. */
export interface NormalizedRecord {
  canonicalType: CanonicalType;
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
   * retried (e.g. rate-limited, temporary unavailability) without the piece
   * needing to throw a RetryableException. Defaults to false when absent.
   * Use RetryableException for thrown errors; use this field for returned
   * non-2xx responses that are safe to retry.
   */
  retry?: boolean;
}
