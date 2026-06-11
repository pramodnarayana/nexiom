export interface RoutingRepositoryPort {
  /**
   * Checks if a normalized record exists for the given traceId.
   */
  hasNormalizedRecord(traceId: string, schemaName: string, tx?: any): Promise<boolean>;

  /**
   * Returns the replicaId associated with the given traceId, or null if not found.
   */
  getReplicaIdByTraceId(traceId: string, schemaName: string, tx?: any): Promise<string | null>;

  /**
   * Checks if any normalized record exists for the given replicaId that is NOT the given traceId.
   */
  hasSupersedingNormalizedRecord(replicaId: string, excludeTraceId: string, schemaName: string, tx?: any): Promise<boolean>;
}

export const ROUTING_REPOSITORY_PORT = Symbol('ROUTING_REPOSITORY_PORT');
