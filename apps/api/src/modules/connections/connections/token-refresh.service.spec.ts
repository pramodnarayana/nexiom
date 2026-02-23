import { DefaultOAuthRefreshClient } from './token-refresh.service';
import { ProviderRegistryService } from '@nexiom/connections';
import { ConnectorsService } from '../connectors.service';
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
  type Mocked,
  type Mock,
} from 'vitest';

describe('DefaultOAuthRefreshClient', () => {
  let client: DefaultOAuthRefreshClient;
  let mockProviderRegistry: Mocked<Partial<ProviderRegistryService>>;
  let mockConnectorsService: {
    fetchAppCredential: Mock;
    decryptClientSecret: Mock;
  };

  beforeEach(() => {
    mockProviderRegistry = {
      getProvider: vi.fn(),
    };
    mockConnectorsService = {
      fetchAppCredential: vi.fn(),
      decryptClientSecret: vi.fn(),
    };

    client = new DefaultOAuthRefreshClient(
      mockProviderRegistry as ProviderRegistryService,
      mockConnectorsService as unknown as ConnectorsService,
    );

    // Mock the global fetch
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('should throw an error if the provider is not found in the registry', async () => {
    (mockProviderRegistry.getProvider as Mock).mockReturnValue(null);
    await expect(
      client.refresh('testTenant', 'unknown_app', 'refresh123'),
    ).rejects.toThrow('Provider not found for refresh: unknown_app');
  });

  it('should throw an error if the provider lacks a tokenUrl', async () => {
    (mockProviderRegistry.getProvider as Mock).mockReturnValue({
      name: 'salesforce',
      displayName: 'Salesforce',
      description: 'CRM',
      logoUrl: '',
      category: 'CRM',
      authType: 'OAUTH2' as const,
      authorizeUrl: 'https://login.salesforce.com/services/oauth2/authorize',
      tokenUrl: '',
      scopes: [],
    });

    await expect(
      client.refresh('testTenant', 'salesforce', 'refresh123'),
    ).rejects.toThrow(
      'Provider salesforce does not support OAuth refresh or lacks a token url',
    );
  });

  it('should successfully call the vendor token URL and return the new mapped payload', async () => {
    (mockProviderRegistry.getProvider as Mock).mockReturnValue({
      name: 'quickbooks',
      displayName: 'QuickBooks',
      description: 'Accounting',
      logoUrl: '',
      category: 'Accounting',
      authType: 'OAUTH2',
      authorizeUrl: 'https://appcenter.intuit.com/connect/oauth2',
      tokenUrl: 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer',
      scopes: ['com.intuit.quickbooks.accounting'],
    });

    mockConnectorsService.fetchAppCredential.mockResolvedValue({
      clientId: 'mock-client-id',
      encryptedClientSecret: 'mock-encrypted-secret',
    });
    mockConnectorsService.decryptClientSecret.mockResolvedValue(
      'mock-decrypted-secret',
    );

    const mockResponsePayload = {
      access_token: 'new_access',
      refresh_token: 'new_refresh',
      expires_in: 3600,
    };

    (globalThis.fetch as Mock).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponsePayload),
    });

    const result = await client.refresh(
      'testTenant',
      'quickbooks',
      'old_refresh',
    );

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(result).toEqual(mockResponsePayload);
  });

  it('should throw an error with specific message if credential retrieval fails', async () => {
    (mockProviderRegistry.getProvider as Mock).mockReturnValue({
      name: 'quickbooks',
      displayName: 'QuickBooks',
      description: 'Accounting',
      logoUrl: '',
      category: 'Accounting',
      authType: 'OAUTH2',
      authorizeUrl: 'https://appcenter.intuit.com/connect/oauth2',
      tokenUrl: 'https://oauth.url',
      scopes: ['com.intuit.quickbooks.accounting'],
    });

    mockConnectorsService.fetchAppCredential.mockRejectedValue(
      new Error('Credential not found'),
    );

    await expect(
      client.refresh('testTenant', 'quickbooks', 'refresh123'),
    ).rejects.toThrow(
      'Failed to retrieve app credential for tenantId/appName: Credential not found',
    );
  });

  it('should throw an error with specific message if credential decryption fails', async () => {
    (mockProviderRegistry.getProvider as Mock).mockReturnValue({
      name: 'quickbooks',
      displayName: 'QuickBooks',
      description: 'Accounting',
      logoUrl: '',
      category: 'Accounting',
      authType: 'OAUTH2',
      authorizeUrl: 'https://appcenter.intuit.com/connect/oauth2',
      tokenUrl: 'https://oauth.url',
      scopes: ['com.intuit.quickbooks.accounting'],
    });

    mockConnectorsService.fetchAppCredential.mockResolvedValue({
      clientId: 'mock-client-id',
      encryptedClientSecret: 'mock-encrypted-secret',
    });

    mockConnectorsService.decryptClientSecret.mockRejectedValue(
      new Error('decryption failed'),
    );

    await expect(
      client.refresh('testTenant', 'quickbooks', 'refresh123'),
    ).rejects.toThrow(
      'Failed to retrieve app credential for tenantId/appName: decryption failed',
    );
  });

  it('should throw an error containing the status code if the vendor rejects the refresh', async () => {
    (mockProviderRegistry.getProvider as Mock).mockReturnValue({
      name: 'quickbooks',
      displayName: 'QuickBooks',
      description: 'Accounting',
      logoUrl: '',
      category: 'Accounting',
      authType: 'OAUTH2',
      authorizeUrl: 'https://appcenter.intuit.com/connect/oauth2',
      tokenUrl: 'https://oauth.url',
      scopes: ['com.intuit.quickbooks.accounting'],
    });

    mockConnectorsService.fetchAppCredential.mockResolvedValue({
      clientId: 'mock-client-id',
      encryptedClientSecret: 'mock-encrypted-secret',
    });
    mockConnectorsService.decryptClientSecret.mockResolvedValue(
      'mock-decrypted-secret',
    );

    (globalThis.fetch as Mock).mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
    });

    await expect(
      client.refresh('testTenant', 'quickbooks', 'bad_refresh'),
    ).rejects.toMatchObject({
      message: expect.stringContaining('OAuth Refresh failed: 401') as unknown,
      status: 401,
    });
  });
});
