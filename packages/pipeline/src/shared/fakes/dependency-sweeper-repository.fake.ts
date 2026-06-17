import { DependencySweeperRepositoryPort, ActiveConnectionWithStitch } from "../ports/dependency-sweeper.repository.port.js";

export class FakeDependencySweeperRepository implements DependencySweeperRepositoryPort {
  public tenants: { tenantId: string }[] = [];
  public activeConnections: ActiveConnectionWithStitch[] = [];
  public deferredTraces: { tenantId: string; schemaName: string; traceId: string; routeId: string; timestamp: number; claimed: boolean }[] = [];
  public replicaDataSources: { tenantId: string; schemaName: string; traceId: string; dataSourceId: string }[] = [];

  async getActiveTenants(): Promise<{ tenantId: string }[]> {
    return this.tenants;
  }

  async getConnectionsWithActiveStitches(): Promise<ActiveConnectionWithStitch[]> {
    return this.activeConnections;
  }

  async getDeferredTraces(tenantId: string, schemaName: string, olderThanMinutes: number): Promise<{ traceId: string; routeId: string }[]> {
    const cutoff = Date.now() - olderThanMinutes * 60 * 1000;
    return this.deferredTraces
      .filter(t => t.tenantId === tenantId && t.schemaName === schemaName && !t.claimed && t.timestamp < cutoff)
      .map(t => ({ traceId: t.traceId, routeId: t.routeId }));
  }

  async getReplicaDataSources(tenantId: string, schemaName: string, traceIds: string[]): Promise<{ traceId: string; dataSourceId: string }[]> {
    return this.replicaDataSources.filter(r => r.tenantId === tenantId && r.schemaName === schemaName && traceIds.includes(r.traceId));
  }

  async claimDeferredTrace(tenantId: string, schemaName: string, traceId: string, routeId: string): Promise<boolean> {
    const trace = this.deferredTraces.find(t => t.tenantId === tenantId && t.schemaName === schemaName && t.traceId === traceId && t.routeId === routeId && !t.claimed);
    if (trace) {
      trace.claimed = true;
      return true;
    }
    return false;
  }

  async unclaimDeferredTrace(tenantId: string, schemaName: string, traceId: string, routeId: string): Promise<boolean> {
    const trace = this.deferredTraces.find(t => t.tenantId === tenantId && t.schemaName === schemaName && t.traceId === traceId && t.routeId === routeId && t.claimed);
    if (trace) {
      trace.claimed = false;
      return true;
    }
    return false;
  }
}
