import { describe, it, expect, vi, beforeEach } from 'vitest';
import { apiClient } from '@/shared/lib/api-client';
import * as DataExplorerApi from './data-explorer.api';

vi.mock('@/shared/lib/api-client', () => ({
  apiClient: {
    get: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    post: vi.fn()
  }
}));

describe('DataExplorer API', () => {
  const mockWorkspaceId = 'w1';
  const mockStitchId = 's1';
  const mockConnectionId = 'c1';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Stitch Explorer Methods', () => {
    const mockData = { data: { data: [{ id: '1' }], total: 1, page: 1, limit: 10 } };

    it('listInbound fetches correctly', async () => {
      vi.mocked(apiClient.get).mockResolvedValueOnce(mockData);
      const res = await DataExplorerApi.listInbound(mockStitchId, { workspaceId: mockWorkspaceId, page: 2, limit: 5, filters: { foo: 'bar' }, objectType: 'Contact' });
      expect(apiClient.get).toHaveBeenCalledWith('/stitches/s1/explorer/inbound?workspaceId=w1&page=2&limit=5&filters=%7B%22foo%22%3A%22bar%22%7D&objectType=Contact');
      expect(res).toEqual(mockData.data);
    });

    it('listReplica fetches correctly', async () => {
      vi.mocked(apiClient.get).mockResolvedValueOnce(mockData);
      await DataExplorerApi.listReplica(mockStitchId);
      expect(apiClient.get).toHaveBeenCalledWith('/stitches/s1/explorer/replica?');
    });

    it('listNormalized fetches correctly', async () => {
      vi.mocked(apiClient.get).mockResolvedValueOnce(mockData);
      await DataExplorerApi.listNormalized(mockStitchId);
      expect(apiClient.get).toHaveBeenCalledWith('/stitches/s1/explorer/normalized?');
    });

    it('listEntityMap fetches correctly', async () => {
      vi.mocked(apiClient.get).mockResolvedValueOnce(mockData);
      await DataExplorerApi.listEntityMap(mockStitchId);
      expect(apiClient.get).toHaveBeenCalledWith('/stitches/s1/explorer/entity-map?');
    });

    it('listOutbound fetches correctly', async () => {
      vi.mocked(apiClient.get).mockResolvedValueOnce(mockData);
      await DataExplorerApi.listOutbound(mockStitchId);
      expect(apiClient.get).toHaveBeenCalledWith('/stitches/s1/explorer/outbound?');
    });

    it('listObjectsByStitch fetches correctly', async () => {
      vi.mocked(apiClient.get).mockResolvedValueOnce({ data: ['Contact', 'Lead'] });
      const res = await DataExplorerApi.listObjectsByStitch(mockStitchId, 'inbound', mockWorkspaceId);
      expect(apiClient.get).toHaveBeenCalledWith('/stitches/s1/explorer/inbound/objects?workspaceId=w1');
      expect(res).toEqual(['Contact', 'Lead']);
    });
  });

  describe('Record Methods', () => {
    it('updateRecord updates correctly', async () => {
      await DataExplorerApi.updateRecord(mockWorkspaceId, 'ds1', 'replica', 'r1', { name: 'test' });
      expect(apiClient.put).toHaveBeenCalledWith('/workspaces/w1/data-hub/ds1/replica/r1', { name: 'test' });
    });

    it('deleteRecord deletes correctly', async () => {
      await DataExplorerApi.deleteRecord(mockWorkspaceId, 'ds1', 'replica', 'r1');
      expect(apiClient.delete).toHaveBeenCalledWith('/workspaces/w1/data-hub/ds1/replica/r1');
    });
  });

  describe('Connection Explorer Methods', () => {
    const mockData = { data: { data: [{ id: '1' }], total: 1, page: 1, limit: 10 } };

    it('listConnectionInbound fetches correctly', async () => {
      vi.mocked(apiClient.get).mockResolvedValueOnce(mockData);
      await DataExplorerApi.listConnectionInbound(mockConnectionId, { workspaceId: mockWorkspaceId });
      expect(apiClient.get).toHaveBeenCalledWith('/connections/c1/explorer/inbound?workspaceId=w1');
    });

    it('listConnectionReplica fetches correctly', async () => {
      vi.mocked(apiClient.get).mockResolvedValueOnce(mockData);
      await DataExplorerApi.listConnectionReplica(mockConnectionId);
      expect(apiClient.get).toHaveBeenCalledWith('/connections/c1/explorer/replica?');
    });

    it('listConnectionNormalized fetches correctly', async () => {
      vi.mocked(apiClient.get).mockResolvedValueOnce(mockData);
      await DataExplorerApi.listConnectionNormalized(mockConnectionId);
      expect(apiClient.get).toHaveBeenCalledWith('/connections/c1/explorer/normalized?');
    });

    it('listConnectionOutbound fetches correctly', async () => {
      vi.mocked(apiClient.get).mockResolvedValueOnce(mockData);
      await DataExplorerApi.listConnectionOutbound(mockConnectionId);
      expect(apiClient.get).toHaveBeenCalledWith('/connections/c1/explorer/outbound?');
    });

    it('listObjectsByConnection fetches correctly', async () => {
      vi.mocked(apiClient.get).mockResolvedValueOnce({ data: ['Contact'] });
      await DataExplorerApi.listObjectsByConnection(mockConnectionId, 'inbound', mockWorkspaceId);
      expect(apiClient.get).toHaveBeenCalledWith('/connections/c1/explorer/objects/inbound?workspaceId=w1');
    });

    it('syncConnectionObject posts correctly', async () => {
      vi.mocked(apiClient.post).mockResolvedValueOnce({ data: { success: true } });
      const res = await DataExplorerApi.syncConnectionObject(mockWorkspaceId, mockConnectionId, 'Contact');
      expect(apiClient.post).toHaveBeenCalledWith('/workspaces/w1/connections/c1/sync/Contact');
      expect(res).toEqual({ success: true });
    });
  });

  describe('Trace Methods', () => {
    it('getTrace fetches correctly', async () => {
      vi.mocked(apiClient.get).mockResolvedValueOnce({ data: { traceId: 't1' } });
      await DataExplorerApi.getTrace(mockStitchId, 't1', mockWorkspaceId);
      expect(apiClient.get).toHaveBeenCalledWith('/stitches/s1/explorer/traces/t1?workspaceId=w1');
    });

    it('getConnectionTrace fetches correctly', async () => {
      vi.mocked(apiClient.get).mockResolvedValueOnce({ data: { traceId: 't1' } });
      await DataExplorerApi.getConnectionTrace(mockConnectionId, 't1', mockWorkspaceId);
      expect(apiClient.get).toHaveBeenCalledWith('/connections/c1/explorer/traces/t1?workspaceId=w1');
    });

    it('listTraceRoutes fetches correctly', async () => {
      vi.mocked(apiClient.get).mockResolvedValueOnce({ data: [{ id: 'route1' }] });
      const res = await DataExplorerApi.listTraceRoutes(mockConnectionId, 't1');
      expect(apiClient.get).toHaveBeenCalledWith('/connections/c1/explorer/traces/t1/routes');
      expect(res).toEqual([{ id: 'route1' }]);
    });
  });
});
