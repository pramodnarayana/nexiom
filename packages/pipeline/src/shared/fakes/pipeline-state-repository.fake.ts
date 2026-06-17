import type { PipelineStateRepositoryPort } from '../ports/pipeline-state.repository.port.js';

export class FakePipelineStateRepository implements PipelineStateRepositoryPort {
  public normalizedData = new Map<string, any>();
  public replicaData = new Map<string, any>();
  public replicaEntityState = new Map<string, any>();
  public syncLocks = new Map<string, boolean>();

  async getNormalizedData(traceId: string, schemaName: string, tx?: any): Promise<{ data: Record<string, unknown>; canonicalType: string } | null> {
    return this.normalizedData.get(`${schemaName}_${traceId}`) || null;
  }

  async getReplicaSourceVendorId(traceId: string, schemaName: string, tx?: any): Promise<string | null> {
    const rec = this.replicaData.get(`${schemaName}_${traceId}`);
    return rec ? rec.entityId : null;
  }

  async releaseSyncLock(dataSourceId: string, entityId: string, schemaName: string, tenantId: string): Promise<void> {
    this.syncLocks.delete(`${tenantId}_${schemaName}_${dataSourceId}_${entityId}`);
  }

  async releaseSyncLockByTraceId(tenantId: string, schemaName: string, traceId: string, tx?: any): Promise<void> {
    // Faked logic: simply traceId matches
    for (const [key] of this.syncLocks.entries()) {
      if (key.includes(traceId)) {
        this.syncLocks.delete(key);
      }
    }
  }

  async getDestinationEntityState(
    tenantId: string,
    targetSchemaName: string,
    destDataSourceId: string,
    targetObject: string,
    destEntityId: string
  ): Promise<Record<string, unknown> | null> {
    const key = `${tenantId}_${targetSchemaName}_${destDataSourceId}_${targetObject}_${destEntityId}`;
    return this.replicaEntityState.get(key) || null;
  }
}
