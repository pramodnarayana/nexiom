import { apiClient } from '@/shared/lib/api-client';

export interface ExplorerPage<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

export interface InboundRow {
  id: string;
  traceId: string;
  connectionId: string;
  objectType: string | null;
  extReqId: string | null;
  status: string;
  payload: unknown;
  headers: unknown;
  createdAt: string;
}

export interface ReplicaRow {
  id: string;
  traceId: string;
  connectionId: string;
  entityType: string;
  sourceId: string;
  data: unknown;
  version: number;
  updatedAt: string;
}

export interface NormalizedRow {
  id: string;
  traceId: string;
  canonicalType: string;
  data: unknown;
  createdAt: string;
}

export interface EntityMapRow {
  id: string;
  stitchId: string;
  sourceAppName: string;
  sourceEntityType: string;
  sourceEntityId: string;
  destAppName: string;
  destEntityType: string;
  destEntityId: string;
  lastSyncedAt: string;
}

export interface OutboundRow {
  id: string;
  traceId: string;
  routeId: string;
  status: string;
  statusCode: number | null;
  attemptCount: number;
  reqPayload: unknown;
  resPayload: unknown;
  createdAt: string;
  updatedAt: string;
}

interface Params { page?: number; limit?: number; workspaceId?: string; }

async function listExplorer<T>(stitchId: string, params: Params, segment: string): Promise<ExplorerPage<T>> {
  const q = new URLSearchParams();
  if (params.workspaceId) q.set('workspaceId', params.workspaceId);
  if (params.page !== undefined) q.set('page', String(params.page));
  if (params.limit !== undefined) q.set('limit', String(params.limit));
  const url = `/stitches/${encodeURIComponent(stitchId)}/explorer/${segment}?${q}`;
  const res = await apiClient.get<ExplorerPage<T>>(url);
  return res.data;
}

export async function listInbound(stitchId: string, params: Params = {}): Promise<ExplorerPage<InboundRow>> {
  return listExplorer<InboundRow>(stitchId, params, 'inbound');
}

export async function listReplica(stitchId: string, params: Params = {}): Promise<ExplorerPage<ReplicaRow>> {
  return listExplorer<ReplicaRow>(stitchId, params, 'replica');
}

export async function listNormalized(stitchId: string, params: Params = {}): Promise<ExplorerPage<NormalizedRow>> {
  return listExplorer<NormalizedRow>(stitchId, params, 'normalized');
}

export async function listEntityMap(stitchId: string, params: Params = {}): Promise<ExplorerPage<EntityMapRow>> {
  return listExplorer<EntityMapRow>(stitchId, params, 'entity-map');
}

export async function listOutbound(stitchId: string, params: Params = {}): Promise<ExplorerPage<OutboundRow>> {
  return listExplorer<OutboundRow>(stitchId, params, 'outbound');
}