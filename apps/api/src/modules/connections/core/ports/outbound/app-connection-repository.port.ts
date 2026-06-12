import type {
  StoreOAuthConnectionOptions,
  ProvisionInfo,
} from '../../types/connection.types.js';

export interface AppConnectionRepositoryPort {
  /**
   * Persists an OAuth connection.
   * If id is provided, it does an explicit update.
   * Otherwise, it inserts a new connection.
   * Throws HttpException on duplicate constraint violations.
   */
  storeOAuthConnection(
    options: StoreOAuthConnectionOptions,
  ): Promise<ProvisionInfo>;

  /**
   * Deletes an app_connection. This is a low-level delete.
   * Note: The GEM reference check and ConflictException are handled by the TenantSchema adapter before calling this port.
   */
  deleteConnection(tenantId: string, dataSourceId: string): Promise<void>;
}
