/**
 * Shared type for the ProvisionDatabaseEvent published by the
 * CapacityManagerService and consumed by the TenantProvisionWorker.
 *
 * Re-exported here so the API does not need to import from
 * apps/tenant-provisioner directly.
 */
export interface ProvisionDatabaseEvent {
  /** Pre-generated UUID used both as the pool slot placeholder and DB name suffix. */
  poolSlotId: string;
  /** The base Postgres host URL (without the database name path). */
  hostUrl: string;
}
