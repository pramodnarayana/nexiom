import { describe, it, expect, vi, beforeEach } from 'vitest';
import { apiClient } from '@/shared/lib/api-client';
import * as AdminStitchesApi from './admin-stitches.api';

vi.mock('@/shared/lib/api-client', () => ({
  apiClient: {
    get: vi.fn(),
    patch: vi.fn()
  }
}));

describe('Admin Stitches API', () => {
  const mockStitchId = 's1';
  const mockOrgId = 'o1';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('adminListStitches fetches correctly', async () => {
    vi.mocked(apiClient.get).mockResolvedValueOnce({ data: [{ id: 's1' }] });
    const res = await AdminStitchesApi.adminListStitches();
    expect(apiClient.get).toHaveBeenCalledWith('/admin/stitches');
    expect(res).toEqual([{ id: 's1' }]);
  });

  describe('adminUpdateSchedule', () => {
    it('throws if no fields are provided', async () => {
      await expect(AdminStitchesApi.adminUpdateSchedule(mockStitchId, {}))
        .rejects.toThrow('At least one of syncIntervalMinutes or scheduleEnabled must be provided.');
      expect(apiClient.patch).not.toHaveBeenCalled();
    });

    it('patches correctly with valid payload', async () => {
      vi.mocked(apiClient.patch).mockResolvedValueOnce({ data: { id: 's1' } });
      const payload = { syncIntervalMinutes: 60 };
      const res = await AdminStitchesApi.adminUpdateSchedule(mockStitchId, payload);
      expect(apiClient.patch).toHaveBeenCalledWith(`/admin/stitches/${mockStitchId}/schedule`, payload);
      expect(res).toEqual({ id: 's1' });
    });
  });

  describe('adminBulkUpdateOrgSchedule', () => {
    it('throws if no fields are provided', async () => {
      await expect(AdminStitchesApi.adminBulkUpdateOrgSchedule(mockOrgId, {}))
        .rejects.toThrow('At least one of syncIntervalMinutes or scheduleEnabled must be provided.');
      expect(apiClient.patch).not.toHaveBeenCalled();
    });

    it('patches correctly with valid payload', async () => {
      vi.mocked(apiClient.patch).mockResolvedValueOnce({ data: { updated: [], count: 0 } });
      const payload = { scheduleEnabled: true };
      const res = await AdminStitchesApi.adminBulkUpdateOrgSchedule(mockOrgId, payload);
      expect(apiClient.patch).toHaveBeenCalledWith(`/admin/stitches/org/${mockOrgId}/schedule`, payload);
      expect(res).toEqual({ updated: [], count: 0 });
    });
  });
});
