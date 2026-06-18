export interface ActiveConnectionWithStitch {
  id: string;
  appName: string;
  tenantId: string;
  organizationId: string | null;
  schemaName: string | null;
}

export interface DependencySweeperRepositoryPort {
  getActiveTenants(): Promise<{ tenantId: string }[]>;
  getConnectionsWithActiveStitches(): Promise<ActiveConnectionWithStitch[]>;
  getDeferredTraces(tenantId: string, schemaName: string, olderThanMinutes: number): Promise<{ traceId: string; routeId: string }[]>;
  getReplicaDataSources(tenantId: string, schemaName: string, traceIds: string[]): Promise<{ traceId: string; dataSourceId: string }[]>;
  claimDeferredTrace(tenantId: string, schemaName: string, traceId: string, routeId: string): Promise<boolean>;
  unclaimDeferredTrace?(tenantId: string, schemaName: string, traceId: string, routeId: string): Promise<boolean>;
}

export const DEPENDENCY_SWEEPER_REPOSITORY_PORT = Symbol('DEPENDENCY_SWEEPER_REPOSITORY_PORT');
