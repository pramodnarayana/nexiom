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
    const payload = { workspaceId: 'w1', name: 'Test', srcDataSourceId: '1', destDataSourceId: '2', sourceObject: 'A', targetObject: 'B' };
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

  it('updateSchedule patches correctly', async () => {
    vi.mocked(apiClient.patch).mockResolvedValueOnce({ data: { id: 's1' } });
    const payload = { syncIntervalMinutes: 60 };
    const res = await StitchesApi.updateSchedule(mockStitchId, payload);
    expect(apiClient.patch).toHaveBeenCalledWith(`/stitches/${mockStitchId}/schedule`, payload);
    expect(res).toEqual({ id: 's1' });
  });

  it('archiveStitch deletes correctly', async () => {
    vi.mocked(apiClient.delete).mockResolvedValueOnce({});
    await StitchesApi.archiveStitch(mockStitchId);
    expect(apiClient.delete).toHaveBeenCalledWith(`/stitches/${mockStitchId}`);
  });

  it('triggerSchedule posts correctly', async () => {
    vi.mocked(apiClient.post).mockResolvedValueOnce({});
    await StitchesApi.triggerSchedule(mockStitchId);
    expect(apiClient.post).toHaveBeenCalledWith(`/stitches/${mockStitchId}/schedule/trigger`);
  });

  describe('getSyncIntervalOptions', () => {
    it('returns default options when no current provided', () => {
      const opts = StitchesApi.getSyncIntervalOptions();
      expect(opts).toContainEqual({ label: '30 min', value: 30 });
      expect(opts).toContainEqual({ label: '24 hr', value: 1440 });
    });

    it('returns default options when current is a preset', () => {
      const opts = StitchesApi.getSyncIntervalOptions(60);
      expect(opts.length).toBe(7); // default 7 items
    });

    it('inserts custom interval correctly', () => {
      const opts = StitchesApi.getSyncIntervalOptions(45);
      expect(opts.length).toBe(8);
      expect(opts).toContainEqual({ label: '45 min', value: 45 });
      // ensure sorted
      expect(opts[0].value).toBe(30);
      expect(opts[1].value).toBe(45);
      expect(opts[2].value).toBe(60);
    });
  });
});
