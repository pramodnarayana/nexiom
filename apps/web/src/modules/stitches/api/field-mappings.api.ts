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
