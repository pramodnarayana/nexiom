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
   * The vendor-assigned ID of the created or updated entity.
   * Each Piece is responsible for extracting this from the raw response body
   * and surfacing it here. DeliveryService reads this field for GEM writes.
   * This keeps ID extraction logic inside the Piece, not in the pipeline core.
   */
  entityId?: string;
  /**
   * Optional piece-layer retry opt-in.
   * Set to `true` to signal DeliveryService that this response should be
   * retried without the piece needing to throw a RetryableException.
   */
  retry?: boolean;
  /**
   * The exact payload that was ultimately sent to the vendor API.
   *
   * Pieces MUST populate this field. It may differ from the payload that the
   * pipeline (FanOut) prepared — for example, when a piece performs an internal
   * SyncToken refresh-and-retry, the retried payload carries the fresh SyncToken.
   *
   * DeliveryService writes this value back to outbound_gateway.payload so that
   * the customer support team always sees the exact request that was accepted by
   * the vendor, not an intermediate or stale version.
   */
  sentPayload?: Record<string, unknown>;
}
