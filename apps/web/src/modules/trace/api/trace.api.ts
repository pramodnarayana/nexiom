import { apiClient } from '@/shared/lib/api-client';

export interface TraceSummary {
  id: string;
  traceId: string;
  layer: string;
  status: string;
  durationMs: number | null;
  routeId: string | null;
  timestamp: string;
}

export interface TraceListResult {
  data: TraceSummary[];
  nextCursor: string | null;
}

export interface LayerDetail {
  layer: string;
  status: string;
  durationMs: number | null;
  timestamp: string;
}

export interface FullTrace {
  traceId: string;
  layers: LayerDetail[];
  inboundGateway: {
    id: string;
    connectionId: string;
    objectType: string | null;
    payload: unknown;
    headers: unknown;
    extReqId: string | null;
    status: string;
    createdAt: string;
  } | null;
  replicaEntity: {
    id: string;
    sourceId: string;
    entityType: string;
    data: unknown;
    version: number;
    updatedAt: string;
  } | null;
  normalizedEntity: {
    id: string;
    canonicalType: string;
    data: unknown;
    createdAt: string;
  } | null;
  outboundGateway: {
    id: string;
    routeId: string;
    reqPayload: unknown;
    resPayload: unknown;
    statusCode: number | null;
    status: string;
    attemptCount: number;
    createdAt: string;
    updatedAt: string;
  } | null;
}

export async function listTraces(
  workspaceId: string, // Utilize this now
  stitchId: string,
  params?: { limit?: number; cursor?: string }
): Promise<TraceListResult> {
  const query = new URLSearchParams();
  if (workspaceId) query.set('workspaceId', workspaceId);
  if (params?.limit !== undefined && Number.isFinite(params.limit)) query.set('limit', params.limit.toString());
  if (params?.cursor !== undefined) query.set('cursor', params.cursor);

  const res = await apiClient.get<TraceListResult>(`/stitches/${encodeURIComponent(stitchId)}/traces?${query.toString()}`);
  return res.data;
}

export async function getTrace(workspaceId: string, stitchId: string, traceId: string): Promise<FullTrace> {
  const query = new URLSearchParams();
  if (workspaceId) query.set('workspaceId', workspaceId);
  
  const res = await apiClient.get<FullTrace>(`/stitches/${encodeURIComponent(stitchId)}/traces/${encodeURIComponent(traceId)}?${query.toString()}`);
  return res.data;
}
