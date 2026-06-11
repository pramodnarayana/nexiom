export interface ResolvedStorageProfile {
  tenantId: string;
}

export interface StorageResolverPort {
  /**
   * Resolves the storage profile for a given data source ID.
   */
  resolveStorageProfile(dataSourceId: string): Promise<ResolvedStorageProfile>;
}
