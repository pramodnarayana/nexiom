import { DefaultOAuthRefreshClient } from './token-refresh.service';
import {
  ProviderRegistryService,
  ProviderDefinition,
} from '@nexiom/connections';
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
      mockConnectorsService as any,
    );

    // Mock the global fetch
    vi.stubGlobal('fetch', vi.fn());

    // Stub environment variables for Quickbooks (used in tests)
    vi.stubEnv('QUICKBOOKS_CLIENT_ID', 'test_client_id');
    vi.stubEnv('QUICKBOOKS_CLIENT_SECRET', 'test_client_secret');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
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
      authType: 'OAUTH2',
      tokenUrl: 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer',
    } as unknown as ProviderDefinition);

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

  it('should throw an error containing the status code if the vendor rejects the refresh', async () => {
    (mockProviderRegistry.getProvider as Mock).mockReturnValue({
      name: 'quickbooks',
      authType: 'OAUTH2',
      tokenUrl: 'https://oauth.url',
    } as unknown as ProviderDefinition);

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
      text: () => Promise.resolve('Unauthorized'),
    });

    await expect(
      client.refresh('testTenant', 'quickbooks', 'bad_refresh'),
    ).rejects.toMatchObject({
      message: expect.stringContaining('OAuth Refresh failed: 401') as unknown,
      status: 401,
    });
  });
});
