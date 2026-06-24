import { apiClient } from '@/shared/lib/api-client';
import type { FieldMappingResponse } from './field-mappings.api';

export type StitchStatus = 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';

/** Shared type for sync condition values across all payload/response shapes. */
export type SyncConditionValue = string | number | boolean;

export interface StitchResponse {
  id: string;
  orgId: string;
  workspaceId: string;
  name: string;
  sourceDataSourceId: string;
  destDataSourceId: string;
  canonicalObject: string;
  targetObject: string;
  syncCondition: Array<{
    field: string;
    op: 'eq' | 'neq' | 'gt' | 'lt' | 'contains';
    value: SyncConditionValue;
    logic?: 'AND' | 'OR';
  }>;
  status: StitchStatus;
  config?: Record<string, unknown>;
  fieldMappings?: FieldMappingResponse[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateStitchPayload {
  workspaceId: string;
  name: string;
  sourceDataSourceId: string;
  destDataSourceId: string;
  /** Primary Canonical Hub object name (e.g. "TMS_CARRIER"). */
  canonicalObject: string;
  /** Destination vendor object name (e.g. "Vendor"). NOT NULL in DB. */
  targetObject: string;
  /** Optional filter conditions applied at sync time. */
  syncCondition?: Array<{
    field: string;
    op: 'eq' | 'neq' | 'gt' | 'lt' | 'contains';
    value: SyncConditionValue;
    logic?: 'AND' | 'OR';
  }>;
  /**
   * Field mappings created atomically with the stitch in a single DB transaction.
   * Prevents orphaned stitch rows when the mapping save would otherwise fail
   * after the stitch has already been inserted.
   */
  fieldMappings?: Array<{
    sourceCanonical: string;
    mappingRules: Array<{ src: string; dest: string; transform?: string }>;
  }>;
}


export interface UpdateStitchPayload {
  name?: string;
  status?: StitchStatus;
  syncCondition?: Array<{
    field: string;
    op: 'eq' | 'neq' | 'gt' | 'lt' | 'contains';
    value: SyncConditionValue;
    logic?: 'AND' | 'OR';
  }>;
  config?: Record<string, unknown>;
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

export async function archiveStitch(id: string): Promise<void> {
  await apiClient.delete(`/stitches/${id}`);
}