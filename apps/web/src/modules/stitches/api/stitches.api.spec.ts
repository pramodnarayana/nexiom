import { describe, it, expect, vi, beforeEach } from 'vitest';
import { apiClient } from '@/shared/lib/api-client';
import * as StitchesApi from './stitches.api';

vi.mock('@/shared/lib/api-client', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn()
  }
}));

describe('Stitches API', () => {
  const mockWorkspaceId = 'w1';
  const mockStitchId = 's1';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('listStitches fetches correctly', async () => {
    vi.mocked(apiClient.get).mockResolvedValueOnce({ data: [{ id: 's1' }] });
    const res = await StitchesApi.listStitches(mockWorkspaceId);
    expect(apiClient.get).toHaveBeenCalledWith('/stitches', { params: { workspaceId: mockWorkspaceId } });
    expect(res).toEqual([{ id: 's1' }]);
  });

  it('getStitch fetches correctly', async () => {
    vi.mocked(apiClient.get).mockResolvedValueOnce({ data: { id: 's1' } });
    const res = await StitchesApi.getStitch(mockStitchId);
    expect(apiClient.get).toHaveBeenCalledWith(`/stitches/${mockStitchId}`);
    expect(res).toEqual({ id: 's1' });
  });

  it('createStitch posts correctly', async () => {
    vi.mocked(apiClient.post).mockResolvedValueOnce({ data: { id: 's1' } });
    const payload = { workspaceId: 'w1', name: 'Test', sourceDataSourceId: '1', destDataSourceId: '2', canonicalObject: 'A', targetObject: 'B' };
    const res = await StitchesApi.createStitch(payload);
    expect(apiClient.post).toHaveBeenCalledWith('/stitches', payload);
    expect(res).toEqual({ id: 's1' });
  });

  it('updateStitch patches correctly', async () => {
    vi.mocked(apiClient.patch).mockResolvedValueOnce({ data: { id: 's1' } });
    const payload = { name: 'Updated' };
    const res = await StitchesApi.updateStitch(mockStitchId, payload);
    expect(apiClient.patch).toHaveBeenCalledWith(`/stitches/${mockStitchId}`, payload);
    expect(res).toEqual({ id: 's1' });
  });

  it('archiveStitch deletes correctly', async () => {
    vi.mocked(apiClient.delete).mockResolvedValueOnce({});
    await StitchesApi.archiveStitch(mockStitchId);
    expect(apiClient.delete).toHaveBeenCalledWith(`/stitches/${mockStitchId}`);
  });
});
