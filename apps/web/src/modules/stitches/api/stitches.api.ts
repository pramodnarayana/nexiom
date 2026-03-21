import { apiClient } from '@/shared/lib/api-client';

export type StitchStatus = 'ACTIVE' | 'PAUSED' | 'ARCHIVED';

export interface StitchResponse {
  id: string;
  orgId: string;
  workspaceId: string;
  name: string;
  srcConnectionId: string;
  destConnectionId: string;
  sourceObject: string;
  targetObject: string;
  syncCondition: Array<{
    field: string;
    op: 'eq' | 'neq' | 'gt' | 'lt' | 'contains';
    value: string | number | boolean;
    logic?: 'AND' | 'OR';
  }>;
  status: StitchStatus;
  syncIntervalMinutes: number;
  scheduleEnabled: boolean;
  lastScheduledAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateStitchPayload {
  workspaceId: string;
  name: string;
  srcConnectionId: string;
  destConnectionId: string;
}

export interface UpdateStitchPayload {
  name?: string;
  status?: StitchStatus;
}

export interface UpdateSchedulePayload {
  syncIntervalMinutes?: number;
  scheduleEnabled?: boolean;
}

export async function listStitches(workspaceId: string): Promise<StitchResponse[]> {
  const res = await apiClient.get<StitchResponse[]>('/stitches', {
    params: { workspaceId },
  });
  return res.data;
}

export async function getStitch(id: string): Promise<StitchResponse> {
  const res = await apiClient.get<StitchResponse>(`/stitches/${id}`);
  return res.data;
}

export async function createStitch(payload: CreateStitchPayload): Promise<StitchResponse> {
  const res = await apiClient.post<StitchResponse>('/stitches', payload);
  return res.data;
}

export async function updateStitch(
  id: string,
  payload: UpdateStitchPayload,
): Promise<StitchResponse> {
  const res = await apiClient.patch<StitchResponse>(`/stitches/${id}`, payload);
  return res.data;
}

export async function updateSchedule(
  id: string,
  payload: UpdateSchedulePayload,
): Promise<StitchResponse> {
  const res = await apiClient.patch<StitchResponse>(`/stitches/${id}/schedule`, payload);
  return res.data;
}

export async function archiveStitch(id: string): Promise<void> {
  await apiClient.delete(`/stitches/${id}`);
}

export const SYNC_INTERVAL_OPTIONS: { label: string; value: number }[] = [
  { label: '30 min', value: 30 },
  { label: '1 hr', value: 60 },
  { label: '2 hr', value: 120 },
  { label: '4 hr', value: 240 },
  { label: '6 hr', value: 360 },
  { label: '12 hr', value: 720 },
  { label: '24 hr', value: 1440 },
];
