import type { NormalizedRecord } from './canonical/index.js';
import type { AppsConnectorDb } from './db.types.js';

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
   * L3 — Map the extracted vendor domain object into a Soopa canonical record.
   * Returns null if normalization is not applicable for this entity type.
   */
  normalize(
    replica: { entityType: string; data: Record<string, unknown> },
  ): NormalizedRecord | null | Promise<NormalizedRecord | null>;

  /**
   * L3.5 — Optional: Write the normalized entity into application-owned typed tables
   * (e.g. tms_carrier, tms_tp). Receives the live DB transaction so it can
   * participate in the platform's existing transaction boundary.
   *
   * tx and db are typed as unknown so the shard stays database-agnostic at the
   * type level. The implementation casts to DrizzleDb/DrizzleTransaction.
   */
  writeNormalized?(
    tx: unknown,
    db: AppsConnectorDb,
    schemaName: string,
    replicaId: string,
    entityId: string,
    traceId: string,
    normalizedEntityType: string,
    data: Record<string, unknown>,
  ): Promise<void>;

  /**
   * L4 — Optional: Build the enriched context for field-mapping rule hydration.
   * Executes SQL lookups on application-owned typed tables and returns a flat
   * context object merged with normalizedData before rules are applied.
   */
  buildTarget?(
    db: AppsConnectorDb,
    schemaName: string,
    normalizedEntityType: string,
    srcEntityId: string,
  ): Promise<Record<string, unknown>>;

  /**
   * Provision — Optional: Idempotent DDL for application-owned domain tables.
   * Called once per tenant schema when a stitch for this app is first activated.
   * All DDL inside MUST use IF NOT EXISTS.
   */
  provisionDomain?(db: AppsConnectorDb, schemaName: string): Promise<void>;

  /**
   * Optional — Return a custom HTTP response for vendor-specific webhook
   * acknowledgment (e.g. Salesforce Outbound Message SOAP ACK).
   * Return null if this request does not require a custom response.
   */
  getWebhookResponse?(
    body: unknown,
    headers: Record<string, string>,
  ): WebhookResponseShape | null;

  /**
   * Optional — Active Fetching hook. 
   * Given a list of missing dependencies, delegate to the application piece 
   * to fetch them from the source system (e.g., using a Composite API) and 
   * ingest them into the L1 gateway.
   */
  activeFetch?(
    missingDependencies: Array<{ entityType: string; sourceId: string }>,
    dataSourceId: string,
  ): Promise<void>;

  /**
   * Optional — Reverse Lookup hook.
   * After L3 normalization writes a child entity to the database, this hook 
   * is called to find any parent entities that might have been paused 
   * (DEFERRED_DEPENDENCY) waiting for this child.
   * Returns an array of parent traceIds to be re-triggered.
   */
  reverseLookup?(
    db: AppsConnectorDb,
    schemaName: string,
    normalizedEntityType: string,
    entityId: string,
  ): Promise<string[]>;

  /**
   * Optional — Prepare Update hook.
   * Called before L5 executeAction on UPDATE operations. Allows the application
   * to inject destination-specific IDs or SyncTokens into the payload.
   */
  prepareUpdate?(
    payload: Record<string, any>,
    destId?: string,
    destState?: Record<string, any>,
  ): Promise<Record<string, any>> | Record<string, any>;
}
