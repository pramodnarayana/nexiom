import { ConnectionRepositoryPort, ConnectionMetadata } from "../ports/connection.repository.port.js";

export class FakeConnectionRepository implements ConnectionRepositoryPort {
  public connections: (ConnectionMetadata & { dataSourceId: string })[] = [];

  async getGlobalConnectionMeta(dataSourceId: string): Promise<{ tenantId: string } | null> {
    const conn = this.connections.find(c => c.dataSourceId === dataSourceId);
    return conn ? { tenantId: conn.tenantId } : null;
  }

  async getTenantConnectionMeta(dataSourceId: string, tenantId: string): Promise<ConnectionMetadata | null> {
    return this.connections.find(c => c.dataSourceId === dataSourceId && c.tenantId === tenantId) || null;
  }
}
