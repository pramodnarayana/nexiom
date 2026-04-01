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
  status: 'FAIL' | 'RETRY' | 'DISMISSED';
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
  if (params?.status !== undefined && params?.status !== null) query.set('status', params.status.toString());
  if (params?.limit !== undefined && params?.limit !== null) query.set('limit', params.limit.toString());
  if (params?.cursor !== undefined && params?.cursor !== null) query.set('cursor', params.cursor.toString());

  const qs = query.toString();
  const res = await apiClient.get<ExceptionListResult>(qs ? `/exceptions?${qs}` : `/exceptions`);
  return res.data;
}

export async function retryException(id: string): Promise<{ queued: boolean }> {
  const res = await apiClient.post<{ queued: boolean }>(`/exceptions/${encodeURIComponent(id)}/retry`);
  return res.data;
}

export async function dismissException(id: string): Promise<{ dismissed: boolean }> {
  const res = await apiClient.post<{ dismissed: boolean }>(`/exceptions/${encodeURIComponent(id)}/dismiss`);
  return res.data;
}
