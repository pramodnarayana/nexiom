import type { NormalizedRecord } from '@nexiom/piece-framework';

// ---------------------------------------------------------------------------
// ApplicationShardModule — the contract every application shard must satisfy.
//
// This is the ONLY shared type between the platform and application code.
// It has no implementation — pure TypeScript interface, no platform imports.
//
// Every shard loaded by ApplicationLoaderService must export these named
// functions. Optional hooks (getWebhookResponse) may be omitted.
// ---------------------------------------------------------------------------

export type WebhookResponseShape = {
  status: number;
  contentType: string;
  body: string;
};

export interface ApplicationShardModule {
  /**
   * L2 — Extract a stable entity identity from the raw inbound webhook payload.
   * Returns null if the payload is not applicable (e.g. wrong event type).
   */
  extractReplica(
    payload: unknown,
  ): { entityType: string; entityId: string; data: Record<string, unknown> } | null;

  /**
   * L3 — Map the extracted vendor domain object into a Nexiom canonical record.
   * Returns null if normalization is not applicable for this entity type.
   */
  normalize(
    replica: { entityType: string; data: Record<string, unknown> },
  ): NormalizedRecord | null | Promise<NormalizedRecord | null>;

  /**
   * L3.5 — Write the normalized entity into application-owned typed tables
   * (e.g. tms_carrier, tms_tp). Receives the live DB transaction so it can
   * participate in the platform's existing transaction boundary.
   *
   * tx and db are typed as unknown so the shard stays database-agnostic at the
   * type level. The implementation casts to DrizzleDb/DrizzleTransaction.
   */
  writeNormalized(
    tx: unknown,
    db: unknown,
    schemaName: string,
    replicaId: string,
    entityId: string,
    traceId: string,
    normalizedEntityType: string,
    data: Record<string, unknown>,
  ): Promise<void>;

  /**
   * L4 — Build the enriched context for field-mapping rule hydration.
   * Executes SQL lookups on application-owned typed tables and returns a flat
   * context object merged with normalizedData before rules are applied.
   */
  buildTarget(
    db: unknown,
    schemaName: string,
    normalizedEntityType: string,
    srcEntityId: string,
  ): Promise<Record<string, unknown>>;

  /**
   * Provision — Idempotent DDL for application-owned domain tables.
   * Called once per tenant schema when a stitch for this app is first activated.
   * All DDL inside MUST use IF NOT EXISTS.
   */
  provisionDomain(db: unknown, schemaName: string): Promise<void>;

  /**
   * Optional — Return a custom HTTP response for vendor-specific webhook
   * acknowledgment (e.g. Salesforce Outbound Message SOAP ACK).
   * Return null if this request does not require a custom response.
   */
  getWebhookResponse?(
    body: unknown,
    headers: Record<string, string>,
  ): WebhookResponseShape | null;
}
