export interface PipelineStateRepositoryPort {
  /**
   * Retrieves the raw data and canonical type from the normalized_entity table for a given traceId.
   */
  getNormalizedData(traceId: string, schemaName: string, tx?: any): Promise<{ data: Record<string, unknown>; canonicalType: string } | null>;

  /**
   * Retrieves the source entityId from the replica_entity table for a given traceId.
   */
  getReplicaSourceVendorId(traceId: string, schemaName: string, tx?: any): Promise<string | null>;

  /**
   * Deletes an active sync lock.
   */
  releaseSyncLock(dataSourceId: string, entityId: string, schemaName: string, tenantId: string): Promise<void>;

  /**
   * Deletes an active sync lock by traceId.
   */
  releaseSyncLockByTraceId(tenantId: string, schemaName: string, traceId: string, tx?: any): Promise<void>;

  /**
   * Retrieves the destination entity state from the replica_entity table.
   */
  getDestinationEntityState(
    tenantId: string,
    targetSchemaName: string,
    destDataSourceId: string,
    targetObject: string,
    destEntityId: string
  ): Promise<Record<string, unknown> | null>;
}

export const PIPELINE_STATE_REPOSITORY_PORT = Symbol('PIPELINE_STATE_REPOSITORY_PORT');
