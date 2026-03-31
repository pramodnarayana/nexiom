import { apiClient } from '@/shared/lib/api-client';

export type ExceptionStatus = 'unresolved' | 'dismissed';

export interface ExceptionItem {
  id: string;
  traceId: string;
  routeId: string;
  reqPayload: unknown;
  resPayload: unknown;
  statusCode: number | null;
  attemptCount: number;
  status: string;
  createdAt: string;
  updatedAt: string;
  updatedAtRaw: string;
}

export interface ExceptionListResult {
  data: ExceptionItem[];
  total: number;
  limit: number;
  nextCursor: string | null;
}

export async function listExceptions(params?: {
  status?: ExceptionStatus;
  limit?: number;
  cursor?: string;
}): Promise<ExceptionListResult> {
  const query = new URLSearchParams();
  if (params?.status) query.set('status', params.status);
  if (params?.limit) query.set('limit', params.limit.toString());
  if (params?.cursor) query.set('cursor', params.cursor);

  const res = await apiClient.get<ExceptionListResult>(`/exceptions?${query.toString()}`);
  return res.data;
}

export async function retryException(id: string): Promise<{ queued: boolean }> {
  const res = await apiClient.post<{ queued: boolean }>(`/exceptions/${id}/retry`);
  return res.data;
}

export async function dismissException(id: string): Promise<{ dismissed: boolean }> {
  const res = await apiClient.post<{ dismissed: boolean }>(`/exceptions/${id}/dismiss`);
  return res.data;
}
