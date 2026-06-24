import { apiClient } from '@/shared/lib/api-client';

export type EnvType = 'PRODUCTION' | 'SANDBOX';

export interface WorkspaceResponse {
  id: string;
  orgId: string;
  name: string;
  envType: EnvType;
  createdAt: string;
  updatedAt: string;
}

export interface CreateWorkspacePayload {
  name: string;
  envType?: EnvType;
}

export interface UpdateWorkspacePayload {
  name?: string;
  envType?: EnvType;
}

export async function listWorkspaces(): Promise<WorkspaceResponse[]> {
  const res = await apiClient.get<WorkspaceResponse[]>('/workspaces');
  return res.data;
}

export async function getWorkspace(id: string): Promise<WorkspaceResponse> {
  const res = await apiClient.get<WorkspaceResponse>(`/workspaces/${id}`);
  return res.data;
}

export async function createWorkspace(payload: CreateWorkspacePayload): Promise<WorkspaceResponse> {
  const res = await apiClient.post<WorkspaceResponse>('/workspaces', payload);
  return res.data;
}

export async function updateWorkspace(id: string, payload: UpdateWorkspacePayload): Promise<WorkspaceResponse> {
  const res = await apiClient.patch<WorkspaceResponse>(`/workspaces/${id}`, payload);
  return res.data;
}

export async function deleteWorkspace(id: string): Promise<void> {
  await apiClient.delete(`/workspaces/${id}`);
}

export interface WorkspaceConnectionResponse {
  id: string;
  appName: string;
  externalId: string;
  displayName: string;
  authType: string;
  status: string;
  assignedAt: string;
}

export async function listWorkspaceConnections(workspaceId: string): Promise<WorkspaceConnectionResponse[]> {
  const res = await apiClient.get<WorkspaceConnectionResponse[]>(`/workspaces/${workspaceId}/connections`);
  return res.data;
}
export interface SyncResult {
  status: 'success' | 'failed' | 'partial';
  message?: string;
  recordsSynced?: number;
  recordsFailed?: number;
}

export async function syncConnection(workspaceId: string, dataSourceId: string, objectType: string): Promise<SyncResult> {
  const res = await apiClient.post<SyncResult>(`/workspaces/${workspaceId}/connections/${dataSourceId}/sync/${objectType}`);
  return res.data;
}

export async function fetchConnectionRecords(workspaceId: string, dataSourceId: string, objectType: string, recordIds: string[]): Promise<SyncResult> {
  const res = await apiClient.post<SyncResult>(`/workspaces/${workspaceId}/connections/${dataSourceId}/sync/${objectType}/fetch`, { recordIds });
  return res.data;
}
