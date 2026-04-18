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

function buildQuery(stitchId: string, params: Params) {
  const q = new URLSearchParams();
  if (params.workspaceId) q.set('workspaceId', params.workspaceId);
  if (params.page !== undefined) q.set('page', String(params.page));
  if (params.limit !== undefined) q.set('limit', String(params.limit));
  return `/stitches/${encodeURIComponent(stitchId)}/explorer`;
}

export async function listInbound(stitchId: string, params: Params = {}): Promise<ExplorerPage<InboundRow>> {
  const q = new URLSearchParams();
  if (params.workspaceId) q.set('workspaceId', params.workspaceId);
  if (params.page) q.set('page', String(params.page));
  if (params.limit) q.set('limit', String(params.limit));
  const res = await apiClient.get<ExplorerPage<InboundRow>>(`${buildQuery(stitchId, params)}/inbound?${q}`);
  return res.data;
}

export async function listReplica(stitchId: string, params: Params = {}): Promise<ExplorerPage<ReplicaRow>> {
  const q = new URLSearchParams();
  if (params.workspaceId) q.set('workspaceId', params.workspaceId);
  if (params.page) q.set('page', String(params.page));
  if (params.limit) q.set('limit', String(params.limit));
  const res = await apiClient.get<ExplorerPage<ReplicaRow>>(`${buildQuery(stitchId, params)}/replica?${q}`);
  return res.data;
}

export async function listNormalized(stitchId: string, params: Params = {}): Promise<ExplorerPage<NormalizedRow>> {
  const q = new URLSearchParams();
  if (params.workspaceId) q.set('workspaceId', params.workspaceId);
  if (params.page) q.set('page', String(params.page));
  if (params.limit) q.set('limit', String(params.limit));
  const res = await apiClient.get<ExplorerPage<NormalizedRow>>(`${buildQuery(stitchId, params)}/normalized?${q}`);
  return res.data;
}

export async function listEntityMap(stitchId: string, params: Params = {}): Promise<ExplorerPage<EntityMapRow>> {
  const q = new URLSearchParams();
  if (params.workspaceId) q.set('workspaceId', params.workspaceId);
  if (params.page) q.set('page', String(params.page));
  if (params.limit) q.set('limit', String(params.limit));
  const res = await apiClient.get<ExplorerPage<EntityMapRow>>(`${buildQuery(stitchId, params)}/entity-map?${q}`);
  return res.data;
}

export async function listOutbound(stitchId: string, params: Params = {}): Promise<ExplorerPage<OutboundRow>> {
  const q = new URLSearchParams();
  if (params.workspaceId) q.set('workspaceId', params.workspaceId);
  if (params.page) q.set('page', String(params.page));
  if (params.limit) q.set('limit', String(params.limit));
  const res = await apiClient.get<ExplorerPage<OutboundRow>>(`${buildQuery(stitchId, params)}/outbound?${q}`);
  return res.data;
}
