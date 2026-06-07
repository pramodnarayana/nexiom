export interface GlobalOutboxRecord {
  id: string;
  tenantId: string;
  entityType: 'APP_CONNECTION' | 'UI_WORKSPACE' | 'INTEGRATION_STITCH' | 'FIELD_MAPPING';
  entityId: string;
  action: 'UPSERT' | 'DELETE';
  payload: Record<string, unknown> | null;
  status: 'PENDING' | 'SUCCESS' | 'FAIL';
}

export interface DataSourceMetadata {
  id: string;
  appName: string;
  metadata: unknown;
}

export interface IRegistryReplicationPort {
  fetchGlobalOutboxRecord(outboxId: string): Promise<GlobalOutboxRecord | null>;

  replicateEntity(
    tenantId: string,
    action: 'UPSERT' | 'DELETE',
    entityType: 'APP_CONNECTION' | 'UI_WORKSPACE' | 'INTEGRATION_STITCH' | 'FIELD_MAPPING',
    entityId: string,
    payload: Record<string, unknown> | null
  ): Promise<void>;

  getStitchDataSources(
    tenantId: string,
    srcDataSourceId: string,
    destDataSourceId: string
  ): Promise<DataSourceMetadata[]>;

  markGlobalOutboxSuccess(outboxId: string): Promise<void>;
}
