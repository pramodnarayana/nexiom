import { apiClient } from '@/shared/lib/api-client';

export interface ObjectDescriptor {
  name: string;
  label: string;
  queryable: boolean;
}

export interface FieldDescriptor {
  name: string;
  label: string;
  type: string;
  updateable?: boolean;
  createable?: boolean;
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
