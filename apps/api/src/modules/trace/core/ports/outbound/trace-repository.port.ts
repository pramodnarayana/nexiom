export interface TraceSummary {
  id: string;
  traceId: string;
  layer: string;
  status: string;
  durationMs: number | null;
  routeId: string | null;
  timestamp: Date;
}

export interface TraceListResult {
  data: TraceSummary[];
  nextCursor: string | null;
}

export interface LayerDetail {
  layer: string;
  status: string;
  durationMs: number | null;
  timestamp: Date;
}

export interface FullTrace {
  traceId: string;
  layers: LayerDetail[];
  inboundGateway: {
    id: string;
    dataSourceId: string;
    objectType: string | null;
    request: unknown;
    response: unknown;
    headers: unknown;
    extReqId: string | null;
    status: string;
    createdAt: Date;
  } | null;
  replicaEntity: {
    id: string;
    entityId: string;
    entityType: string;
    data: unknown;
    version: number;
    updatedAt: Date;
  } | null;
  normalizedEntity: {
    id: string;
    canonicalType: string;
    data: unknown;
    createdAt: Date;
  } | null;
  outboundGateway: {
    id: string;
    routeId: string;
    reqPayload: unknown;
    resPayload: unknown;
    statusCode: number | null;
    status: string;
    attemptCount: number;
    createdAt: Date;
    updatedAt: Date;
  } | null;
}

export interface TraceRepositoryPort {
  /**
   * Resolves the source connection ID for a given stitch.
   */
  resolveSourceConnectionForStitch(
    orgId: string,
    stitchId: string,
    destDataSourceId: string,
    destSchemaName: string,
  ): Promise<string>;

  /**
   * Returns a paginated list of trace summaries.
   */
  listTraces(
    orgId: string,
    stitchId: string,
    workspaceId: string | undefined,
    srcSchemaName: string,
    limit: number,
    cursorTs: Date | undefined,
    cursorId: string | undefined,
  ): Promise<TraceListResult>;

  /**
   * Returns the full trace details (L1-L6) for a given trace ID.
   */
  getTrace(
    stitchId: string,
    traceId: string,
    srcDataSourceId: string,
    srcSchemaName: string,
    destSchemaName: string,
  ): Promise<FullTrace>;
}
