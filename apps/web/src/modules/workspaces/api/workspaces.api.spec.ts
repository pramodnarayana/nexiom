import { describe, it, expect, vi, beforeEach } from 'vitest';
import { apiClient } from '@/shared/lib/api-client';
import * as WorkspacesApi from './workspaces.api';

vi.mock('@/shared/lib/api-client', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn()
  }
}));

describe('Workspaces API', () => {
  const mockWorkspaceId = 'w1';
  const mockDataSourceId = 'ds1';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('listWorkspaces fetches correctly', async () => {
    vi.mocked(apiClient.get).mockResolvedValueOnce({ data: [{ id: 'w1' }] });
    const res = await WorkspacesApi.listWorkspaces();
    expect(apiClient.get).toHaveBeenCalledWith('/workspaces');
    expect(res).toEqual([{ id: 'w1' }]);
  });

  it('getWorkspace fetches correctly', async () => {
    vi.mocked(apiClient.get).mockResolvedValueOnce({ data: { id: 'w1' } });
    const res = await WorkspacesApi.getWorkspace(mockWorkspaceId);
    expect(apiClient.get).toHaveBeenCalledWith(`/workspaces/${mockWorkspaceId}`);
    expect(res).toEqual({ id: 'w1' });
  });

  it('createWorkspace posts correctly', async () => {
    vi.mocked(apiClient.post).mockResolvedValueOnce({ data: { id: 'w2' } });
    const payload = { name: 'Test WS', envType: 'SANDBOX' as const };
    const res = await WorkspacesApi.createWorkspace(payload);
    expect(apiClient.post).toHaveBeenCalledWith('/workspaces', payload);
    expect(res).toEqual({ id: 'w2' });
  });

  it('updateWorkspace patches correctly', async () => {
    vi.mocked(apiClient.patch).mockResolvedValueOnce({ data: { id: 'w1' } });
    const payload = { name: 'Updated WS' };
    const res = await WorkspacesApi.updateWorkspace(mockWorkspaceId, payload);
    expect(apiClient.patch).toHaveBeenCalledWith(`/workspaces/${mockWorkspaceId}`, payload);
    expect(res).toEqual({ id: 'w1' });
  });

  it('deleteWorkspace deletes correctly', async () => {
    vi.mocked(apiClient.delete).mockResolvedValueOnce({});
    await WorkspacesApi.deleteWorkspace(mockWorkspaceId);
    expect(apiClient.delete).toHaveBeenCalledWith(`/workspaces/${mockWorkspaceId}`);
  });

  it('listWorkspaceConnections fetches correctly', async () => {
    vi.mocked(apiClient.get).mockResolvedValueOnce({ data: [{ id: 'c1' }] });
    const res = await WorkspacesApi.listWorkspaceConnections(mockWorkspaceId);
    expect(apiClient.get).toHaveBeenCalledWith(`/workspaces/${mockWorkspaceId}/connections`);
    expect(res).toEqual([{ id: 'c1' }]);
  });

  it('syncConnection posts correctly', async () => {
    vi.mocked(apiClient.post).mockResolvedValueOnce({ data: { success: true } });
    const res = await WorkspacesApi.syncConnection(mockWorkspaceId, mockDataSourceId, 'Customer');
    expect(apiClient.post).toHaveBeenCalledWith(`/workspaces/${mockWorkspaceId}/connections/${mockDataSourceId}/sync/Customer`);
    expect(res).toEqual({ success: true });
  });

  it('fetchConnectionRecords posts correctly', async () => {
    vi.mocked(apiClient.post).mockResolvedValueOnce({ data: { success: true } });
    const res = await WorkspacesApi.fetchConnectionRecords(mockWorkspaceId, mockDataSourceId, 'Customer', ['id1']);
    expect(apiClient.post).toHaveBeenCalledWith(
      `/workspaces/${mockWorkspaceId}/connections/${mockDataSourceId}/sync/Customer/fetch`,
      { recordIds: ['id1'] }
    );
    expect(res).toEqual({ success: true });
  });
});
