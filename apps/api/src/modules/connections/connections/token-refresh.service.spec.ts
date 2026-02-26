import { DefaultOAuthRefreshClient } from './token-refresh.service';
import {
  ProviderRegistryService,
  EncryptionService,
  OAuthRefreshError,
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

const QUICKBOOKS_PROVIDER = {
  name: 'quickbooks',
  displayName: 'QuickBooks',
  description: 'Accounting',
  logoUrl: '',
  category: 'Accounting',
  authType: 'OAUTH2' as const,
  authorizeUrl: 'https://appcenter.intuit.com/connect/oauth2',
  tokenUrl: 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer',
  scopes: ['com.intuit.quickbooks.accounting'],
};

describe('DefaultOAuthRefreshClient', () => {
  let client: DefaultOAuthRefreshClient;
  let mockProviderRegistry: Mocked<Partial<ProviderRegistryService>>;
  let mockEncryptionService: { encrypt: Mock; decrypt: Mock };
  let mockDb: {
    select: Mock;
    from: Mock;
    where: Mock;
    orderBy: Mock;
    limit: Mock;
  };

  const encryptedValueBlob = 'encrypted-value-payload';
  const decryptedValueBlob = JSON.stringify({
    clientId: 'mock-client-id',
    clientSecret: 'mock-client-secret',
    accessToken: 'mock-access-token',
    refreshToken: 'mock-refresh-token',
    data: {},
  });

  beforeEach(() => {
    mockProviderRegistry = { getProvider: vi.fn() };

    mockEncryptionService = {
      encrypt: vi.fn(),
      decrypt: vi.fn().mockResolvedValue(decryptedValueBlob),
    };

    // Chain: db.select().from().where().limit() -> returns [{value}]
    mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{ value: encryptedValueBlob }]),
    };

    client = new DefaultOAuthRefreshClient(
      mockProviderRegistry as ProviderRegistryService,
      mockDb as unknown as import('@nexiom/database').DrizzleDb,
      mockEncryptionService as unknown as EncryptionService,
    );

    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('should throw an error if the provider is not found in the registry', async () => {
    (mockProviderRegistry.getProvider as Mock).mockReturnValue(null);
    await expect(
      client.refresh('testTenant', 'unknown_app', 'test-ext', 'refresh123'),
    ).rejects.toThrow('Provider not found for refresh: unknown_app');
  });

  it('should throw an error if the provider lacks a tokenUrl', async () => {
    (mockProviderRegistry.getProvider as Mock).mockReturnValue({
      ...QUICKBOOKS_PROVIDER,
      tokenUrl: '',
    });

    await expect(
      client.refresh('testTenant', 'quickbooks', 'test-ext', 'refresh123'),
    ).rejects.toThrow(
      'Provider quickbooks does not support OAuth refresh or lacks a token url',
    );
  });

  it('should successfully call the vendor token URL and return the new token payload', async () => {
    (mockProviderRegistry.getProvider as Mock).mockReturnValue(
      QUICKBOOKS_PROVIDER,
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
      'test-ext',
      'old_refresh',
    );

    expect(mockDb.select).toHaveBeenCalled();
    expect(mockEncryptionService.decrypt).toHaveBeenCalledWith(
      encryptedValueBlob,
    );
    expect(globalThis.fetch).toHaveBeenCalledWith(
      QUICKBOOKS_PROVIDER.tokenUrl,
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('grant_type=refresh_token') as unknown,
      }),
    );
    expect(result).toEqual(mockResponsePayload);
  });

  it('should throw an OAuthRefreshError if no active connection is found', async () => {
    (mockProviderRegistry.getProvider as Mock).mockReturnValue(
      QUICKBOOKS_PROVIDER,
    );
    mockDb.limit.mockResolvedValue([]); // no connections found

    try {
      await client.refresh(
        'testTenant',
        'quickbooks',
        'test-ext',
        'refresh123',
      );
      expect.unreachable('Should have thrown an error');
    } catch (error) {
      expect(error).toBeInstanceOf(OAuthRefreshError);
      expect((error as OAuthRefreshError).status).toBe(500);
      expect((error as OAuthRefreshError).message).toContain(
        'No active connection found',
      );
    }
  });

  it('should throw an OAuthRefreshError if credential decryption fails', async () => {
    (mockProviderRegistry.getProvider as Mock).mockReturnValue(
      QUICKBOOKS_PROVIDER,
    );
    mockEncryptionService.decrypt.mockRejectedValue(
      new Error('decryption failed'),
    );

    try {
      await client.refresh(
        'testTenant',
        'quickbooks',
        'test-ext',
        'refresh123',
      );
      expect.unreachable('Should have thrown an error');
    } catch (error) {
      expect(error).toBeInstanceOf(OAuthRefreshError);
      expect((error as OAuthRefreshError).status).toBe(500);
      expect((error as OAuthRefreshError).message).toContain(
        'decryption failed',
      );
    }
  });

  it('should throw an OAuthRefreshError with status code if the vendor rejects the refresh', async () => {
    (mockProviderRegistry.getProvider as Mock).mockReturnValue(
      QUICKBOOKS_PROVIDER,
    );

    (globalThis.fetch as Mock).mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
    });

    await expect(
      client.refresh('testTenant', 'quickbooks', 'test-ext', 'bad_refresh'),
    ).rejects.toMatchObject({
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      message: expect.stringContaining('OAuth Refresh failed: 401'),
      status: 401,
    } satisfies Partial<OAuthRefreshError>);
  });

  it('should re-wrap unexpected errors as OAuthRefreshError', async () => {
    (mockProviderRegistry.getProvider as Mock).mockReturnValue(
      QUICKBOOKS_PROVIDER,
    );

    (globalThis.fetch as Mock).mockRejectedValue(new Error('network timeout'));

    await expect(
      client.refresh('testTenant', 'quickbooks', 'test-ext', 'old_refresh'),
    ).rejects.toBeInstanceOf(OAuthRefreshError);
  });
});
