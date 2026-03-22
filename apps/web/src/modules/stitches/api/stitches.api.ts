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

/** Full payload once the T023 field-mapping wizard can supply all required fields. */
export interface CreateStitchPayload {
  workspaceId: string;
  name: string;
  srcConnectionId: string;
  destConnectionId: string;
  /** Vendor object name on the source connection (e.g. "Contact"). NOT NULL in DB. */
  sourceObject: string;
  /** Vendor object name on the destination connection (e.g. "Customer"). NOT NULL in DB. */
  targetObject: string;
}

/**
 * Partial payload used before T023 (field-mapping wizard) is implemented.
 * sourceObject and targetObject are omitted here; the API Zod schema defaults
 * them to '' server-side.  Switch callers to CreateStitchPayload once T023 lands.
 */
export type DraftStitchPayload = Omit<CreateStitchPayload, 'sourceObject' | 'targetObject'>;

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

// T023: accepts DraftStitchPayload (no sourceObject/targetObject) until the field-mapping wizard lands.
// Switch callers to CreateStitchPayload and update this signature once T023 is implemented.
export async function createStitch(payload: DraftStitchPayload): Promise<StitchResponse> {
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

const PRESET_SYNC_INTERVALS: { label: string; value: number }[] = [
  { label: '30 min', value: 30 },
  { label: '1 hr', value: 60 },
  { label: '2 hr', value: 120 },
  { label: '4 hr', value: 240 },
  { label: '6 hr', value: 360 },
  { label: '12 hr', value: 720 },
  { label: '24 hr', value: 1440 },
];

/**
 * Returns the sync interval options for UI dropdowns.
 * If `current` is a positive integer not already in the preset list
 * (e.g. a support-team override), it is inserted in sorted order with a
 * generated label so the UI can display and resubmit the value correctly.
 */
export function getSyncIntervalOptions(
  current?: number,
): { label: string; value: number }[] {
  const presetValues = new Set(PRESET_SYNC_INTERVALS.map((o) => o.value));
  if (current !== undefined && current > 0 && !presetValues.has(current)) {
    const custom = { label: `${current} min`, value: current };
    return [...PRESET_SYNC_INTERVALS, custom].sort((a, b) => a.value - b.value);
  }
  return PRESET_SYNC_INTERVALS;
}
