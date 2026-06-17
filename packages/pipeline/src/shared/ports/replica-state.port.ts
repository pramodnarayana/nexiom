export interface InboundRecord {
  id: string;
  traceId: string;
  status: string;
  request: Record<string, unknown>;
}

export interface ExtractedReplica {
  entityId: string;
  entityType: string;
  data: Record<string, unknown>;
}

export interface ReplicaStatePort {
  fetchInboundRecord(
    tenantId: string,
    schemaName: string,
    traceId: string
  ): Promise<InboundRecord | null>;

  persistReplicaExtraction(
    tenantId: string,
    schemaName: string,
    dataSourceId: string,
    traceId: string,
    inboundRecordId: string,
    extracted: ExtractedReplica,
    durationMs: number
  ): Promise<void>;

  markInboundFail(
    tenantId: string,
    schemaName: string,
    traceId: string,
    errorMessage: string,
    durationMs: number
  ): Promise<void>;
}
