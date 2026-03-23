import { apiClient } from '@/shared/lib/api-client';

export interface ObjectDescriptor {
  name: string;
  label: string;
  queryable: boolean;
}

/**
 * Mirrors the FieldDescriptor returned by piece.describeFields and the
 * /stitches/metadata/:connectionId/objects/:objectName/fields endpoint.
 * Matches packages/connectors/src/framework/piece.ts FieldDescriptor exactly.
 */
export interface FieldDescriptor {
  name: string;
  label: string;
  type: string;
  filterable: boolean;
  sortable: boolean;
  nillable: boolean;
  /** Present only when type === 'reference'. */
  referenceTo?: string[];
}

export async function listObjects(
  connectionId: string,
  options?: { refresh?: boolean },
): Promise<ObjectDescriptor[]> {
  const res = await apiClient.get<ObjectDescriptor[]>(
    `/stitches/metadata/${connectionId}/objects`,
    { params: options?.refresh ? { refresh: true } : undefined },
  );
  return res.data;
}

export async function listFields(
  connectionId: string,
  objectName: string,
): Promise<FieldDescriptor[]> {
  const res = await apiClient.get<FieldDescriptor[]>(
    `/stitches/metadata/${connectionId}/objects/${encodeURIComponent(objectName)}/fields`,
  );
  return res.data;
}
