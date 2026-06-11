export interface DataSourceMetadata {
  appName: string;
  appProfile: string;
}

export interface DataSourceRepositoryPort {
  /**
   * Retrieves the application name and profile for a given data source.
   * Throws if the data source is not found.
   */
  getDataSourceMetadata(dataSourceId: string): Promise<DataSourceMetadata>;
}
