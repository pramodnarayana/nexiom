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

/**
 * Helper to build request config for metadata endpoints with cache-busting.
 * When refresh is true, adds Cache-Control: no-cache header and refresh=true param.
 */
function buildRefreshConfig(refresh: boolean): {
  params?: Record<string, boolean>;
  headers?: Record<string, string>;
} {
  if (!refresh) return {};
  return {
    params: { refresh: true },
    headers: { 'Cache-Control': 'no-cache' },
  };
}

export async function listObjects(
  connectionId: string,
  options?: { refresh?: boolean },
): Promise<ObjectDescriptor[]> {
  const config = buildRefreshConfig(options?.refresh ?? false);
  const res = await apiClient.get<ObjectDescriptor[]>(
    `/stitches/metadata/${connectionId}/objects`,
    config,
  );
  return res.data;
}

export async function listFields(
  connectionId: string,
  objectName: string,
  refresh = false,
): Promise<FieldDescriptor[]> {
  const config = buildRefreshConfig(refresh);
  const res = await apiClient.get<FieldDescriptor[]>(
    `/stitches/metadata/${connectionId}/objects/${encodeURIComponent(objectName)}/fields`,
    config,
  );
  return res.data;
}

export interface RelatedObjectDescriptor {
  objectName: string;
  objectLabel?: string;
  relationshipType: '1:1' | '1:N';
  relationField: string;
  relationLabel?: string;
}

export async function listRelatedObjects(
  connectionId: string,
  objectName: string,
  options?: { refresh?: boolean },
): Promise<RelatedObjectDescriptor[]> {
  const config = buildRefreshConfig(options?.refresh ?? false);
  const res = await apiClient.get<RelatedObjectDescriptor[]>(
    `/stitches/metadata/${connectionId}/objects/${encodeURIComponent(objectName)}/related`,
    config,
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