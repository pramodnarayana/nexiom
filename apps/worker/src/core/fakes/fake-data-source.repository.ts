/* eslint-disable @typescript-eslint/require-await */
import type {
  DataSourceRepositoryPort,
  DataSourceMetadata,
} from "../ports/outbound/data-source-repository.port.js";

export class FakeDataSourceRepository implements DataSourceRepositoryPort {
  public dataSources = new Map<string, DataSourceMetadata>();

  async getDataSourceMetadata(
    dataSourceId: string,
  ): Promise<DataSourceMetadata> {
    const metadata = this.dataSources.get(dataSourceId);
    if (!metadata) {
      throw new Error(`Data source ${dataSourceId} not found`);
    }
    return metadata;
  }
}
