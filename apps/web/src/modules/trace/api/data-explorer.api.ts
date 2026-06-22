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
  dataSourceId: string;
  objectType: string | null;
  extReqId: string | null;
  status: string;
  request: unknown;
  response: unknown;
  headers: unknown;
  createdAt: string;
}

export interface ReplicaRow {
  id: string;
  traceId: string;
  dataSourceId: string;
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
  payload: unknown;
  response: unknown;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Params { page?: number; limit?: number; workspaceId?: string; filters?: unknown; objectType?: string; canonicalType?: string; }

async function listExplorer<T>(stitchId: string, params: Params, segment: string): Promise<ExplorerPage<T>> {
  const q = new URLSearchParams();
  if (params.workspaceId) q.set('workspaceId', params.workspaceId);
  if (params.page !== undefined) q.set('page', String(params.page));
  if (params.limit !== undefined) q.set('limit', String(params.limit));
  if (params.filters) q.set('filters', JSON.stringify(params.filters));
  if (params.objectType) q.set('objectType', params.objectType);
  if (params.canonicalType) q.set('canonicalType', params.canonicalType);
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

export async function listObjectsByStitch(stitchId: string, tab: string, workspaceId?: string): Promise<string[]> {
  const q = new URLSearchParams();
  if (workspaceId) q.set('workspaceId', workspaceId);
  const url = `/stitches/${encodeURIComponent(stitchId)}/explorer/${encodeURIComponent(tab)}/objects?${q}`;
  const res = await apiClient.get<string[]>(url);
  return res.data;
}

export async function updateRecord(workspaceId: string, dataSourceId: string, tab: string, recordId: string, payload: unknown): Promise<void> {
  const url = `/workspaces/${encodeURIComponent(workspaceId)}/data-hub/${encodeURIComponent(dataSourceId)}/${encodeURIComponent(tab)}/${encodeURIComponent(recordId)}`;
  await apiClient.put(url, payload);
}

export async function deleteRecord(workspaceId: string, dataSourceId: string, tab: string, recordId: string): Promise<void> {
  const url = `/workspaces/${encodeURIComponent(workspaceId)}/data-hub/${encodeURIComponent(dataSourceId)}/${encodeURIComponent(tab)}/${encodeURIComponent(recordId)}`;
  await apiClient.delete(url);
}

// ─── Connection Explorer API ───

async function listConnectionExplorer<T>(connectionId: string, params: Params, segment: string): Promise<ExplorerPage<T>> {
  const q = new URLSearchParams();
  if (params.workspaceId) q.set('workspaceId', params.workspaceId);
  if (params.page !== undefined) q.set('page', String(params.page));
  if (params.limit !== undefined) q.set('limit', String(params.limit));
  if (params.filters) q.set('filters', JSON.stringify(params.filters));
  if (params.objectType) q.set('objectType', params.objectType);
  if (params.canonicalType) q.set('canonicalType', params.canonicalType);
  const url = `/connections/${encodeURIComponent(connectionId)}/explorer/${segment}?${q}`;
  const res = await apiClient.get<ExplorerPage<T>>(url);
  return res.data;
}

export async function listConnectionInbound(connectionId: string, params: Params = {}): Promise<ExplorerPage<InboundRow>> {
  return listConnectionExplorer<InboundRow>(connectionId, params, 'inbound');
}

export async function listConnectionReplica(connectionId: string, params: Params = {}): Promise<ExplorerPage<ReplicaRow>> {
  return listConnectionExplorer<ReplicaRow>(connectionId, params, 'replica');
}

export async function listConnectionNormalized(connectionId: string, params: Params = {}): Promise<ExplorerPage<NormalizedRow>> {
  return listConnectionExplorer<NormalizedRow>(connectionId, params, 'normalized');
}

export async function listConnectionOutbound(connectionId: string, params: Params = {}): Promise<ExplorerPage<OutboundRow>> {
  return listConnectionExplorer<OutboundRow>(connectionId, params, 'outbound');
}

export async function listObjectsByConnection(connectionId: string, tab: string, workspaceId?: string): Promise<string[]> {
  const q = new URLSearchParams();
  if (workspaceId) q.set('workspaceId', workspaceId);
  const url = `/connections/${encodeURIComponent(connectionId)}/explorer/objects/${tab}?${q}`;
  const res = await apiClient.get<string[]>(url);
  return res.data;
}

export async function listConnectionNormalizedTypes(connectionId: string, objectType: string): Promise<string[]> {
  const q = new URLSearchParams({ objectType });
  const url = `/connections/${encodeURIComponent(connectionId)}/explorer/normalized/types?${q}`;
  const res = await apiClient.get<string[]>(url);
  return res.data;
}

export async function syncConnectionObject(workspaceId: string, connectionId: string, objectType: string): Promise<unknown> {
  const url = `/workspaces/${encodeURIComponent(workspaceId)}/connections/${encodeURIComponent(connectionId)}/sync/${encodeURIComponent(objectType)}`;
  const res = await apiClient.post(url);
  return res.data;
}


export interface TraceData {
  traceId: string;
  stitchId: string | null;
  layers: {
    l1: InboundRow | null;
    l2: ReplicaRow | null;
    l3: NormalizedRow | null;
    l6: OutboundRow | null;
  };
}

export async function getTrace(stitchId: string, traceId: string, workspaceId?: string): Promise<TraceData> {
  const q = new URLSearchParams();
  if (workspaceId) q.set('workspaceId', workspaceId);
  const url = `/stitches/${encodeURIComponent(stitchId)}/explorer/traces/${encodeURIComponent(traceId)}?${q}`;
  const res = await apiClient.get<TraceData>(url);
  return res.data;
}

export async function getConnectionTrace(connectionId: string, traceId: string, workspaceId?: string): Promise<TraceData> {
  const q = new URLSearchParams();
  if (workspaceId) q.set('workspaceId', workspaceId);
  const url = `/connections/${encodeURIComponent(connectionId)}/explorer/traces/${encodeURIComponent(traceId)}?${q}`;
  const res = await apiClient.get<TraceData>(url);
  return res.data;
}

export async function listTraceRoutes(connectionId: string, traceId: string): Promise<Array<{ id: string, name: string, destDataSourceId: string }>> {
  const url = `/connections/${encodeURIComponent(connectionId)}/explorer/traces/${encodeURIComponent(traceId)}/routes`;
  const res = await apiClient.get<Array<{ id: string, name: string, destDataSourceId: string }>>(url);
  return res.data;
}