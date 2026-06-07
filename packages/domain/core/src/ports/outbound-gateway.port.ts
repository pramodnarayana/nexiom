export interface OutboundGatewayRecord {
  id: string;
  traceId: string;
  routeId: string;
  dataSourceId: string;
  srcDataSourceId: string;
  payload: Record<string, unknown>;
  status: 'PENDING' | 'PROCESSING' | 'SUCCESS' | 'FAIL' | 'RETRY';
  attempts: number;
}

export interface IOutboundGatewayPort {
  insertOrFetchPending(
    tenantId: string,
    destSchemaName: string,
    record: Omit<OutboundGatewayRecord, 'id' | 'status' | 'attempts'>
  ): Promise<{ id: string; attempts: number; status: string }>;

  claimForProcessing(
    tenantId: string,
    destSchemaName: string,
    id: string
  ): Promise<boolean>;

  markResult(
    tenantId: string,
    destSchemaName: string,
    id: string,
    status: 'SUCCESS' | 'FAIL' | 'RETRY',
    statusCode: number,
    response: Record<string, unknown> | null,
    sentPayload: Record<string, unknown> | null,
    destVendorId?: string,
    replicaUpdate?: {
      traceId: string;
      dataSourceId: string;
      targetObject: string;
    }
  ): Promise<void>;
}
