import { apiClient } from '@/shared/lib/api-client';

export interface MappingRule {
  src: string;
  dest: string;
  transform?: string;
}

export interface UpsertFieldMappingPayload {
  sourceCanonical: string;
  mappingRules: MappingRule[];
}

export interface FieldMappingResponse {
  id: string;
  stitchId: string;
  sourceCanonical: string;
  mappingRules: MappingRule[];
  createdAt: string;
  updatedAt: string;
}

export async function upsertFieldMapping(
  stitchId: string,
  payload: UpsertFieldMappingPayload,
): Promise<FieldMappingResponse> {
  const res = await apiClient.post<FieldMappingResponse>(
    `/stitches/${stitchId}/mappings`,
    payload,
  );
  return res.data;
}

/**
 * Permanently deletes all mapping rules for the given canonical on a stitch.
 * Called when the user removes a source-object tab or saves with all rules cleared.
 * Throws if the canonical has no saved DB record (caller should guard for this).
 */
export async function deleteFieldMapping(
  stitchId: string,
  sourceCanonical: string,
): Promise<void> {
  await apiClient.delete(
    `/stitches/${stitchId}/mappings/${encodeURIComponent(sourceCanonical)}`,
  );
}
