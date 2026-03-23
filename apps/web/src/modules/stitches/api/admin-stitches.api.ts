import { apiClient } from '@/shared/lib/api-client';
import type { StitchResponse } from './stitches.api';

/**
 * At least one field must be provided.
 * The backend's buildScheduleSet throws BadRequestException when both are absent,
 * so callers should validate before sending to avoid an unnecessary round-trip.
 */
export interface AdminUpdateSchedulePayload {
  syncIntervalMinutes?: number;
  scheduleEnabled?: boolean;
}

/** Throws if neither field is set — mirrors backend buildScheduleSet validation. */
function assertSchedulePayload(payload: AdminUpdateSchedulePayload): void {
  if (payload.syncIntervalMinutes === undefined && payload.scheduleEnabled === undefined) {
    throw new Error('At least one of syncIntervalMinutes or scheduleEnabled must be provided.');
  }
}

export async function adminListStitches(): Promise<StitchResponse[]> {
  const res = await apiClient.get<StitchResponse[]>('/admin/stitches');
  return res.data;
}

export async function adminUpdateSchedule(
  id: string,
  payload: AdminUpdateSchedulePayload,
): Promise<StitchResponse> {
  assertSchedulePayload(payload);
  const res = await apiClient.patch<StitchResponse>(
    `/admin/stitches/${id}/schedule`,
    payload,
  );
  return res.data;
}

export interface BulkUpdateOrgScheduleResponse {
  updated: StitchResponse[];
  count: number;
}

export async function adminBulkUpdateOrgSchedule(
  orgId: string,
  payload: AdminUpdateSchedulePayload,
): Promise<BulkUpdateOrgScheduleResponse> {
  assertSchedulePayload(payload);
  const res = await apiClient.patch<BulkUpdateOrgScheduleResponse>(
    `/admin/stitches/org/${orgId}/schedule`,
    payload,
  );
  return res.data;
}
