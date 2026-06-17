export interface GlobalOutboxRecord {
  id: string;
  tenantId: string;
  entityType: 'APP_CONNECTION' | 'UI_WORKSPACE' | 'INTEGRATION_STITCH' | 'FIELD_MAPPING' | 'SCHEMA_PROVISION';
  entityId: string;
  action: 'UPSERT' | 'DELETE' | 'APPLY';
  payload: Record<string, unknown> | null;
  status: 'PENDING' | 'SUCCESS' | 'FAIL';
}

export interface DataSourceMetadata {
  id: string;
  appName: string;
  vendorTenantId: string | null;
  metadata: unknown;
}

export interface IRegistryReplicationPort {
  fetchGlobalOutboxRecord(outboxId: string): Promise<GlobalOutboxRecord | null>;

  replicateEntity(
    tenantId: string,
    action: 'UPSERT' | 'DELETE' | 'APPLY',
    entityType: 'APP_CONNECTION' | 'UI_WORKSPACE' | 'INTEGRATION_STITCH' | 'FIELD_MAPPING' | 'SCHEMA_PROVISION',
    entityId: string,
    payload: Record<string, unknown> | null
  ): Promise<void>;

  getStitchDataSources(
    tenantId: string,
    srcDataSourceId: string,
    destDataSourceId: string
  ): Promise<DataSourceMetadata[]>;

  markGlobalOutboxSuccess(outboxId: string): Promise<void>;
  markConnectionStatus(
    tenantId: string,
    connectionId: string,
    status: 'ACTIVE' | 'INACTIVE' | 'EXPIRED' | 'REVOKED' | 'PROVISIONING' | 'FAILED'
  ): Promise<void>;
}
