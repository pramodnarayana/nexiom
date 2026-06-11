export interface TriggerStorageResolverPort {
  /**
   * Resolves the actual schema name for a given data source ID.
   */
  resolveSchemaName(dataSourceId: string): Promise<string>;
}
