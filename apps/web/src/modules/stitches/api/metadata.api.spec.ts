import { describe, it, expect, vi, beforeEach } from 'vitest';
import { apiClient } from '@/shared/lib/api-client';
import * as MetadataApi from './metadata.api';

vi.mock('@/shared/lib/api-client', () => ({
  apiClient: {
    get: vi.fn(),
  }
}));

describe('Metadata API', () => {
  const mockDataSourceId = 'ds1';
  const mockObjectName = 'Contact';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('listObjects fetches correctly without refresh', async () => {
    vi.mocked(apiClient.get).mockResolvedValueOnce({ data: [{ name: 'Contact' }] });
    const res = await MetadataApi.listObjects(mockDataSourceId);
    expect(apiClient.get).toHaveBeenCalledWith(`/stitches/metadata/${mockDataSourceId}/objects`, {});
    expect(res).toEqual([{ name: 'Contact' }]);
  });

  it('listObjects fetches correctly with refresh', async () => {
    vi.mocked(apiClient.get).mockResolvedValueOnce({ data: [] });
    await MetadataApi.listObjects(mockDataSourceId, { refresh: true });
    expect(apiClient.get).toHaveBeenCalledWith(`/stitches/metadata/${mockDataSourceId}/objects`, {
      params: { refresh: true },
      headers: { 'Cache-Control': 'no-cache' }
    });
  });

  it('listFields fetches correctly without refresh', async () => {
    vi.mocked(apiClient.get).mockResolvedValueOnce({ data: [{ name: 'id' }] });
    const res = await MetadataApi.listFields(mockDataSourceId, mockObjectName);
    expect(apiClient.get).toHaveBeenCalledWith(`/stitches/metadata/${mockDataSourceId}/objects/${mockObjectName}/fields`, {});
    expect(res).toEqual([{ name: 'id' }]);
  });

  it('listFields fetches correctly with refresh', async () => {
    vi.mocked(apiClient.get).mockResolvedValueOnce({ data: [] });
    await MetadataApi.listFields(mockDataSourceId, mockObjectName, true);
    expect(apiClient.get).toHaveBeenCalledWith(`/stitches/metadata/${mockDataSourceId}/objects/${mockObjectName}/fields`, {
      params: { refresh: true },
      headers: { 'Cache-Control': 'no-cache' }
    });
  });

  it('listRelatedObjects fetches correctly', async () => {
    vi.mocked(apiClient.get).mockResolvedValueOnce({ data: [{ objectName: 'Account' }] });
    const res = await MetadataApi.listRelatedObjects(mockDataSourceId, mockObjectName);
    expect(apiClient.get).toHaveBeenCalledWith(`/stitches/metadata/${mockDataSourceId}/objects/${mockObjectName}/related`, {});
    expect(res).toEqual([{ objectName: 'Account' }]);
  });

  it('describeConfig fetches correctly', async () => {
    vi.mocked(apiClient.get).mockResolvedValueOnce({ data: [{ name: 'apiKey' }] });
    const res = await MetadataApi.describeConfig(mockDataSourceId);
    expect(apiClient.get).toHaveBeenCalledWith(`/stitches/metadata/${mockDataSourceId}/config`);
    expect(res).toEqual([{ name: 'apiKey' }]);
  });
});
