import type { AppConnectionRepositoryPort } from '../ports/outbound/app-connection-repository.port.js';
import type {
  StoreOAuthConnectionOptions,
  ProvisionInfo,
} from '../types/connection.types.js';

export class FakeAppConnectionRepository implements AppConnectionRepositoryPort {
  public connections = new Map<string, StoreOAuthConnectionOptions>();
  public callCount = {
    storeOAuthConnection: 0,
    deleteConnection: 0,
  };

  storeOAuthConnection(
    options: StoreOAuthConnectionOptions,
  ): Promise<ProvisionInfo> {
    this.callCount.storeOAuthConnection++;
    const id = options.id || `conn_${Date.now()}`;

    // In a real DB, constraint checks would happen here.
    this.connections.set(id, { ...options, id });

    return Promise.resolve({
      schemaName: options.id
        ? ''
        : `schema_${options.tenantId}_${options.providerName}`,
      dataSourceId: `ds_${id}`,
      createdAppConnection: !options.id,
    });
  }

  deleteConnection(tenantId: string, dataSourceId: string): Promise<void> {
    this.callCount.deleteConnection++;

    // Find connection by dataSourceId (in fake world, we can just find it or assume it's deleted)
    for (const [key, value] of this.connections.entries()) {
      if (
        value.tenantId === tenantId &&
        // We simulate that the dataSourceId is generated based on the connection ID
        dataSourceId === `ds_${value.id}`
      ) {
        this.connections.delete(key);
        break;
      }
    }
    return Promise.resolve();
  }
}
