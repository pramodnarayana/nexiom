import { describe, it, expect, vi, beforeEach } from 'vitest';
import { apiClient } from '@/shared/lib/api-client';
import * as FieldMappingsApi from './field-mappings.api';

vi.mock('@/shared/lib/api-client', () => ({
  apiClient: {
    post: vi.fn(),
    delete: vi.fn()
  }
}));

describe('Field Mappings API', () => {
  const mockStitchId = 's1';
  const mockSourceCanonical = 'Contact';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('upsertFieldMapping posts correctly', async () => {
    vi.mocked(apiClient.post).mockResolvedValueOnce({ data: { id: 'm1' } });
    const payload = { sourceCanonical: mockSourceCanonical, mappingRules: [] };
    const res = await FieldMappingsApi.upsertFieldMapping(mockStitchId, payload);
    expect(apiClient.post).toHaveBeenCalledWith(`/stitches/${mockStitchId}/mappings`, payload);
    expect(res).toEqual({ id: 'm1' });
  });

  it('deleteFieldMapping deletes correctly', async () => {
    vi.mocked(apiClient.delete).mockResolvedValueOnce({});
    await FieldMappingsApi.deleteFieldMapping(mockStitchId, mockSourceCanonical);
    expect(apiClient.delete).toHaveBeenCalledWith(`/stitches/${mockStitchId}/mappings/${mockSourceCanonical}`);
  });

  it('bulkUpsertAndDeleteFieldMappings posts correctly', async () => {
    vi.mocked(apiClient.post).mockResolvedValueOnce({ data: [{ id: 'm1' }] });
    const payload = { toUpsert: [], toDelete: [] };
    const res = await FieldMappingsApi.bulkUpsertAndDeleteFieldMappings(mockStitchId, payload);
    expect(apiClient.post).toHaveBeenCalledWith(`/stitches/${mockStitchId}/mappings/bulk`, payload);
    expect(res).toEqual([{ id: 'm1' }]);
  });
});
