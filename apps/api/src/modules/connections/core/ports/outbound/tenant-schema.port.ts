import type { ProvisionInfo } from '../../types/connection.types.js';

export interface TenantSchemaPort {
  /**
   * Provisions the schema for a tenant database for the given connection.
   */
  provisionNamespace(
    tenantId: string,
    workspaceProvisionInfo: ProvisionInfo,
    providerName: string,
    metadata: Record<string, unknown>,
  ): Promise<void>;

  /**
   * Tears down the schema for a tenant database for the given connection.
   */
  teardownNamespace(tenantId: string, dataSourceId: string): Promise<void>;
}
