export interface ConnectionMetadata {
  tenantId: string;
  appName: string;
  appProfile: string;
  organizationId: string | null;
}

export interface ConnectionRepositoryPort {
  /**
   * Retrieves connection metadata from the global database.
   */
  getGlobalConnectionMeta(dataSourceId: string): Promise<{ tenantId: string } | null>;

  /**
   * Retrieves connection metadata from a tenant database.
   */
  getTenantConnectionMeta(dataSourceId: string, tenantId: string): Promise<ConnectionMetadata | null>;
}

export const CONNECTION_REPOSITORY_PORT = Symbol('CONNECTION_REPOSITORY_PORT');
