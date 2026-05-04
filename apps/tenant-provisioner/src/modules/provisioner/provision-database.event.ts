/**
 * Describes the shape of a message on the TenantProvisionQueue.
 *
 * The Capacity Manager publishes these messages; the TenantProvisionWorker
 * consumes them and creates a physically isolated Postgres database.
 */
export interface ProvisionDatabaseEvent {
  /**
   * A pre-generated UUID used both as the ephemeral tenantId placeholder
   * (e.g. WARM-<uuid>) and the database name suffix.
   */
  poolSlotId: string;

  /**
   * The target Postgres host URL (without the database path).
   * e.g. 'postgresql://user:password@localhost:5432'
   */
  hostUrl: string;
}
