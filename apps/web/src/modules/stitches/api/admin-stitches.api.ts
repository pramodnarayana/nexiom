import { apiClient } from '@/shared/lib/api-client';
import type { StitchResponse } from './stitches.api';

export interface AdminUpdateSchedulePayload {
  syncIntervalMinutes?: number;
  scheduleEnabled?: boolean;
}

export async function adminListStitches(): Promise<StitchResponse[]> {
  const res = await apiClient.get<StitchResponse[]>('/admin/stitches');
  return res.data;
}

export async function adminUpdateSchedule(
  id: string,
  payload: AdminUpdateSchedulePayload,
): Promise<StitchResponse> {
  const res = await apiClient.patch<StitchResponse>(
    `/admin/stitches/${id}/schedule`,
    payload,
  );
  return res.data;
}

export async function adminBulkUpdateOrgSchedule(
  orgId: string,
  payload: AdminUpdateSchedulePayload,
): Promise<StitchResponse[]> {
  const res = await apiClient.patch<StitchResponse[]>(
    `/admin/stitches/org/${orgId}/schedule`,
    payload,
  );
  return res.data;
}
