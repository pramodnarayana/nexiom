export interface ExplorerPage<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

export interface ExplorerRepositoryPort {
  listConnectionInbound(
    tenantId: string,
    schemaName: string,
    connectionId: string,
    page: number,
    limit: number,
    objectType?: string,
    filters?: import('../../../filter-parser.js').FilterGroup,
  ): Promise<ExplorerPage<any>>;

  listConnectionReplica(
    tenantId: string,
    schemaName: string,
    connectionId: string,
    page: number,
    limit: number,
    objectType?: string,
    filters?: import('../../../filter-parser.js').FilterGroup,
  ): Promise<ExplorerPage<any>>;

  listConnectionNormalized(
    tenantId: string,
    schemaName: string,
    connectionId: string,
    page: number,
    limit: number,
    objectType?: string,
    filters?: import('../../../filter-parser.js').FilterGroup,
  ): Promise<ExplorerPage<any>>;

  listConnectionOutbound(
    tenantId: string,
    schemaName: string,
    connectionId: string,
    page: number,
    limit: number,
  ): Promise<ExplorerPage<any>>;

  getConnectionTrace(
    tenantId: string,
    schemaName: string,
    connectionId: string,
    traceId: string,
  ): Promise<{
    inbound: unknown;
    replica: unknown;
    normalized: unknown;
    outbound: unknown;
  }>;

  listTraceRoutes(
    tenantId: string,
    schemaName: string,
    traceId: string,
  ): Promise<string[]>;

  listObjectsByConnection(
    tenantId: string,
    schemaName: string,
    connectionId: string,
    tab: string,
  ): Promise<string[]>;
}
