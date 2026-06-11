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
   * Deletes an app_connection. Validates absence of global_entity_map references.
   * If there's a reference, throws ConflictException.
   */
  deleteConnection(tenantId: string, dataSourceId: string): Promise<void>;
}
