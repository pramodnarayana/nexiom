import { apiClient } from '@/shared/lib/api-client';

export interface ObjectDescriptor {
  name: string;
  label: string;
  queryable: boolean;
}

/**
 * Mirrors the FieldDescriptor returned by piece.describeFields and the
 * /stitches/metadata/:dataSourceId/objects/:objectName/fields endpoint.
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
  dataSourceId: string,
  options?: { refresh?: boolean },
): Promise<ObjectDescriptor[]> {
  const config = buildRefreshConfig(options?.refresh ?? false);
  const res = await apiClient.get<ObjectDescriptor[]>(
    `/stitches/metadata/${dataSourceId}/objects`,
    config,
  );
  return res.data;
}

export async function listFields(
  dataSourceId: string,
  objectName: string,
  refresh = false,
): Promise<FieldDescriptor[]> {
  const config = buildRefreshConfig(refresh);
  const res = await apiClient.get<FieldDescriptor[]>(
    `/stitches/metadata/${dataSourceId}/objects/${encodeURIComponent(objectName)}/fields`,
    config,
  );
  return res.data;
}

export async function listCanonicalObjects(): Promise<ObjectDescriptor[]> {
  const res = await apiClient.get<ObjectDescriptor[]>('/stitches/canonical/objects');
  return res.data;
}

export async function listCanonicalFields(objectName: string): Promise<FieldDescriptor[]> {
  const res = await apiClient.get<FieldDescriptor[]>(
    `/stitches/canonical/objects/${encodeURIComponent(objectName)}/fields`,
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
  dataSourceId: string,
  objectName: string,
  options?: { refresh?: boolean },
): Promise<RelatedObjectDescriptor[]> {
  const config = buildRefreshConfig(options?.refresh ?? false);
  const res = await apiClient.get<RelatedObjectDescriptor[]>(
    `/stitches/metadata/${dataSourceId}/objects/${encodeURIComponent(objectName)}/related`,
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
  dataSourceId: string,
): Promise<ConfigOption[]> {
  const res = await apiClient.get<ConfigOption[]>(
    `/stitches/metadata/${dataSourceId}/config`,
  );
  return res.data;
}