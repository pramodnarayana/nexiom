export interface SyncLogRepositoryPort {
  /**
   * Writes a sync log entry to the tenant's database.
   */
  writeSyncLog(
    tenantId: string,
    schemaName: string,
    traceId: string,
    routeId: string | null,
    layer: "L3" | "L4" | "L5" | "L6",
    status: "PROCESSING" | "SUCCESS" | "FAIL" | "SKIPPED",
    durationMs: number,
    errorMessage?: string,
    tx?: any
  ): Promise<void>;

  /**
   * Checks if a sync log entry exists for a given traceId, routeId, and layer
   * with a status indicating completion (SUCCESS or FAIL).
   */
  hasCompletedSyncLog(
    tenantId: string,
    schemaName: string,
    traceId: string,
    routeId: string,
    layer: string,
  ): Promise<boolean>;
}

export const SYNC_LOG_REPOSITORY_PORT = Symbol('SYNC_LOG_REPOSITORY_PORT');
