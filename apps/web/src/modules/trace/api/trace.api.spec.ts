import { describe, it, expect, vi, beforeEach } from 'vitest';
import { apiClient } from '@/shared/lib/api-client';
import * as TraceApi from './trace.api';

vi.mock('@/shared/lib/api-client', () => ({
  apiClient: {
    get: vi.fn(),
  }
}));

describe('Trace API', () => {
  const mockWorkspaceId = 'w1';
  const mockStitchId = 's1';
  const mockTraceId = 't1';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('listTraces fetches correctly with default params', async () => {
    vi.mocked(apiClient.get).mockResolvedValueOnce({ data: { data: [] } });
    await TraceApi.listTraces(mockWorkspaceId, mockStitchId);
    expect(apiClient.get).toHaveBeenCalledWith('/stitches/s1/traces?workspaceId=w1');
  });

  it('listTraces fetches correctly with cursor and limit', async () => {
    vi.mocked(apiClient.get).mockResolvedValueOnce({ data: { data: [] } });
    await TraceApi.listTraces(mockWorkspaceId, mockStitchId, { cursor: 'c1', limit: 10 });
    expect(apiClient.get).toHaveBeenCalledWith('/stitches/s1/traces?workspaceId=w1&limit=10&cursor=c1');
  });

  it('getTrace fetches correctly', async () => {
    vi.mocked(apiClient.get).mockResolvedValueOnce({ data: { traceId: 't1' } });
    await TraceApi.getTrace(mockWorkspaceId, mockStitchId, mockTraceId);
    expect(apiClient.get).toHaveBeenCalledWith('/stitches/s1/traces/t1?workspaceId=w1');
  });
});
