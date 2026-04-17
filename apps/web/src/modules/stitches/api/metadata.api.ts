import { apiClient } from '@/shared/lib/api-client';

export interface ObjectDescriptor {
  name: string;
  label: string;
  queryable: boolean;
}

/**
 * Mirrors the FieldDescriptor returned by piece.describeFields and the
 * /stitches/metadata/:connectionId/objects/:objectName/fields endpoint.
 * Matches packages/connection-manager/src/framework/piece.ts FieldDescriptor exactly.
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
  refresh = false,
): Promise<FieldDescriptor[]> {
  const params: Record<string, string | number | boolean> = {};
  if (refresh) {
    params['refresh'] = true;
    // Timestamp defeats browser ETag/304 cache — without it the browser
    // sends If-None-Match and the server returns 304 (old data).
    params['_t'] = Date.now();
  }
  const res = await apiClient.get<FieldDescriptor[]>(
    `/stitches/metadata/${connectionId}/objects/${encodeURIComponent(objectName)}/fields`,
    { params: Object.keys(params).length ? params : undefined },
  );
  return res.data;
}

export interface RelatedObjectDescriptor {
  objectName: string;
  relationshipType: '1:1' | '1:N';
  relationField: string;
}

export async function listRelatedObjects(
  connectionId: string,
  objectName: string,
): Promise<RelatedObjectDescriptor[]> {
  const res = await apiClient.get<RelatedObjectDescriptor[]>(
    `/stitches/metadata/${connectionId}/objects/${encodeURIComponent(objectName)}/related`,
  );
  return res.data;
}

export interface ConfigOption {
  name: string;
  label: string;
  type: 'boolean' | 'string' | 'select';
  description?: string;
  options?: Array<{ label: string; value: string }>;
  defaultValue?: unknown;
}

export async function describeConfig(
  connectionId: string,
): Promise<ConfigOption[]> {
  const res = await apiClient.get<ConfigOption[]>(
    `/stitches/metadata/${connectionId}/config`,
  );
  return res.data;
}
