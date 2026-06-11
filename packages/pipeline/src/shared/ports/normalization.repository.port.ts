import { TxContext } from "./transaction-manager.port.js";

export interface ReplicaRecord {
  id: string;
  traceId: string;
  dataSourceId: string;
  entityId: string;
  entityType: string;
  data: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface NormalizationRepositoryPort {
  /**
   * Looks up a replica by its exact traceId.
   */
  findReplicaByTraceId(
    schemaName: string,
    traceId: string,
    tx: TxContext
  ): Promise<ReplicaRecord | null>;

  /**
   * Checks if a replica has been superseded by a newer trace.
   */
  checkIfSuperseded(
    schemaName: string,
    dataSourceId: string,
    entityId: string,
    traceId: string,
    tx: TxContext
  ): Promise<boolean>;

  /**
   * Fetches the original request payload from inbound_gateway for extraction fallback.
   */
  fetchInboundRequest(
    schemaName: string,
    traceId: string,
    tx: TxContext
  ): Promise<Record<string, unknown> | null>;

  /**
   * Idempotent upsert of the normalized entity.
   * Returns the ID of the inserted/updated row.
   */
  upsertNormalizedEntity(
    schemaName: string,
    traceId: string,
    replicaId: string,
    canonicalType: string,
    safeData: Record<string, unknown>,
    tx: TxContext
  ): Promise<string>;

  /**
   * Inserts into normalized_outbox transactionally.
   * On conflict (traceId, dataSourceId), it does nothing.
   */
  insertNormalizedOutboxPending(
    schemaName: string,
    traceId: string,
    dataSourceId: string,
    tx: TxContext
  ): Promise<void>;

  /**
   * Updates normalized_outbox status to SUCCESS (executed outside transaction).
   */
  markNormalizedOutboxSuccess(
    tenantId: string,
    schemaName: string,
    traceId: string,
    dataSourceId: string
  ): Promise<void>;
}

export const NORMALIZATION_REPOSITORY_PORT = Symbol(
  "NORMALIZATION_REPOSITORY_PORT"
);
