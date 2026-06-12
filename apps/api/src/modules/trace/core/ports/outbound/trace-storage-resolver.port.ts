export interface StorageProfile {
  tenantId: string;
  schemaName: string;
}

export interface TraceStorageResolverPort {
  /**
   * Resolves the actual schema name for a given data source ID.
   */
  resolveSchemaName(dataSourceId: string): Promise<string>;

  /**
   * Resolves the full storage profile (tenantId, schemaName) for a data source ID.
   */
  resolveStorageProfile(dataSourceId: string): Promise<StorageProfile>;
}
