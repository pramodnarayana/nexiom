import { describe, it, expect, vi, beforeEach } from 'vitest';
import { apiClient } from '@/shared/lib/api-client';
import * as ConnectionsApi from './connections.api';

vi.mock('@/shared/lib/api-client', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn()
  }
}));

describe('Connections API', () => {
  const mockDataSourceId = 'ds1';
  const mockProviderName = 'salesforce';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('listProviders fetches correctly', async () => {
    vi.mocked(apiClient.get).mockResolvedValueOnce({ data: [{ name: 'salesforce' }] });
    const res = await ConnectionsApi.listProviders();
    expect(apiClient.get).toHaveBeenCalledWith('/connectors/providers');
    expect(res).toEqual([{ name: 'salesforce' }]);
  });

  it('listActiveConnections fetches correctly', async () => {
    vi.mocked(apiClient.get).mockResolvedValueOnce({ data: { data: [{ id: 'c1' }] } });
    const res = await ConnectionsApi.listActiveConnections();
    expect(apiClient.get).toHaveBeenCalledWith('/connectors/active');
    expect(res).toEqual([{ id: 'c1' }]);
  });

  it('getConnectionCredentials fetches correctly', async () => {
    vi.mocked(apiClient.get).mockResolvedValueOnce({ data: { clientId: '123' } });
    const res = await ConnectionsApi.getConnectionCredentials(mockDataSourceId);
    expect(apiClient.get).toHaveBeenCalledWith(`/connectors/active/${mockDataSourceId}/credentials`);
    expect(res).toEqual({ clientId: '123' });
  });

  it('createOAuthSession posts correctly', async () => {
    vi.mocked(apiClient.post).mockResolvedValueOnce({ data: { sessionId: 'sess1' } });
    const payload = { providerName: mockProviderName, clientId: '123' };
    const res = await ConnectionsApi.createOAuthSession(payload);
    expect(apiClient.post).toHaveBeenCalledWith(`/connectors/${mockProviderName}/session`, payload);
    expect(res).toEqual({ sessionId: 'sess1' });
  });

  it('exchangeOAuthCode posts correctly', async () => {
    vi.mocked(apiClient.post).mockResolvedValueOnce({});
    const payload = { providerName: mockProviderName, code: 'code', state: 'state', clientId: '123', displayName: 'My SF' };
    await ConnectionsApi.exchangeOAuthCode(payload);
    expect(apiClient.post).toHaveBeenCalledWith('/connectors/oauth-exchange', payload);
  });

  it('deleteConnection deletes correctly', async () => {
    vi.mocked(apiClient.delete).mockResolvedValueOnce({});
    await ConnectionsApi.deleteConnection(mockDataSourceId);
    expect(apiClient.delete).toHaveBeenCalledWith(`/connectors/${mockDataSourceId}`);
  });
});
