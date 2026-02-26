import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ConnectorsService } from './connectors.service';
import {
  ProviderRegistryService,
  EncryptionService,
  AppCredentialError,
} from '@nexiom/connections';
import {
  InternalServerErrorException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import {
  vi,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  Mocked,
} from 'vitest';

type ProviderResult = ReturnType<ProviderRegistryService['getProvider']>;

describe('ConnectorsService', () => {
  let service: ConnectorsService;
  let mockProviderRegistry: Mocked<ProviderRegistryService>;
  let mockEncryptionService: Mocked<EncryptionService>;
  let mockDbInsert: ReturnType<typeof vi.fn>;
  let mockDbValues: ReturnType<typeof vi.fn>;
  let mockDbOnConflictDoUpdate: ReturnType<typeof vi.fn>;
  let mockDb: {
    select: ReturnType<typeof vi.fn>;
    from: ReturnType<typeof vi.fn>;
    where: ReturnType<typeof vi.fn>;
    insert: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    mockDbOnConflictDoUpdate = vi.fn().mockResolvedValue([]);
    mockDbValues = vi
      .fn()
      .mockReturnValue({ onConflictDoUpdate: mockDbOnConflictDoUpdate });
    mockDbInsert = vi.fn().mockReturnValue({ values: mockDbValues });
    mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([]),
      insert: mockDbInsert,
    };

    mockEncryptionService = {
      decrypt: vi.fn().mockResolvedValue('test-client-secret'),
      encrypt: vi.fn(),
    } as unknown as Mocked<EncryptionService>;

    const mockConfigService = {
      get: vi.fn().mockReturnValue('https://tenant.nexiom.app'),
    };

    mockProviderRegistry = {
      getProvider: vi.fn(),
      getAllProviders: vi.fn(),
    } as unknown as Mocked<ProviderRegistryService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConnectorsService,
        { provide: ProviderRegistryService, useValue: mockProviderRegistry },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: EncryptionService, useValue: mockEncryptionService },
        { provide: 'DRIZZLE_DB', useValue: mockDb as unknown },
      ],
    }).compile();

    service = module.get<ConnectorsService>(ConnectorsService);
  });

  describe('getAuthorizationUrl', () => {
    it('should throw BadRequestException if providerName fails validation', () => {
      expect(() =>
        service.getAuthorizationUrl(
          'invalid/provider_name!',
          'mocked_jwt_state',
          'test-client-id',
        ),
      ).toThrow(BadRequestException);
    });

    it('should generate a valid OAuth URL with scopes', () => {
      mockProviderRegistry.getProvider.mockReturnValue({
        name: 'salesforce',
        authType: 'OAUTH2',
        authorizeUrl: 'https://login.salesforce.com/services/oauth2/authorize',
        scopes: ['full', 'refresh_token'],
      } as unknown as NonNullable<ProviderResult>);

      const result = service.getAuthorizationUrl(
        'salesforce',
        'random-state-123',
        'test-client-id',
      );

      const url = new URL(result);
      expect(url.origin).toBe('https://login.salesforce.com');
      expect(url.pathname).toBe('/services/oauth2/authorize');
      expect(url.searchParams.get('response_type')).toBe('code');
      expect(url.searchParams.get('client_id')).toBe('test-client-id');
      expect(url.searchParams.get('state')).toBe('random-state-123');
      expect(url.searchParams.get('scope')).toBe('full refresh_token');
      expect(url.searchParams.get('redirect_uri')).toBe(
        'https://tenant.nexiom.app/api/connect/callback',
      );
    });

    it('should use environment specific authorizeUrl when env parameter is passed and matched', () => {
      mockProviderRegistry.getProvider.mockReturnValue({
        name: 'salesforce',
        authType: 'OAUTH2',
        authorizeUrl: 'https://login.salesforce.com/services/oauth2/authorize',
        environments: [
          {
            name: 'sandbox',
            displayName: 'Sandbox',
            authorizeUrl:
              'https://test.salesforce.com/services/oauth2/authorize',
          },
        ],
      } as unknown as NonNullable<ProviderResult>);

      const result = service.getAuthorizationUrl(
        'salesforce',
        'random-state-123',
        'test-client-id',
        'sandbox',
      );

      const url = new URL(result);
      expect(url.origin).toBe('https://test.salesforce.com');
      expect(url.pathname).toBe('/services/oauth2/authorize');
    });

    it('should throw BadRequestException when env parameter is passed but does not match', () => {
      mockProviderRegistry.getProvider.mockReturnValue({
        name: 'salesforce',
        authType: 'OAUTH2',
        authorizeUrl: 'https://login.salesforce.com/services/oauth2/authorize',
        environments: [
          {
            name: 'sandbox',
            displayName: 'Sandbox',
            authorizeUrl:
              'https://test.salesforce.com/services/oauth2/authorize',
          },
        ],
      } as unknown as NonNullable<ProviderResult>);

      expect(() =>
        service.getAuthorizationUrl(
          'salesforce',
          'random-state-123',
          'test-client-id',
          'production',
        ),
      ).toThrow(BadRequestException);
    });

    it('should throw NotFoundException if provider does not exist', () => {
      mockProviderRegistry.getProvider.mockReturnValue(null);
      expect(() =>
        service.getAuthorizationUrl('unknown', 'state', 'test-client-id'),
      ).toThrow(NotFoundException);
    });

    it('should throw BadRequestException if clientId is missing', () => {
      mockProviderRegistry.getProvider.mockReturnValue({
        name: 'salesforce',
        authType: 'OAUTH2',
        authorizeUrl: 'https://login.salesforce.com/services/oauth2/authorize',
      } as unknown as NonNullable<ProviderResult>);

      expect(() =>
        service.getAuthorizationUrl('salesforce', 'state', ''),
      ).toThrow(BadRequestException);
    });

    it('should throw InternalServerErrorException if authType is not OAUTH2', () => {
      mockProviderRegistry.getProvider.mockReturnValue({
        name: 'salesforce',
        authType: 'API_KEY',
        authorizeUrl: 'https://login.salesforce.com/services/oauth2/authorize',
      } as unknown as NonNullable<ProviderResult>);

      expect(() =>
        service.getAuthorizationUrl('salesforce', 'state', 'test-client-id'),
      ).toThrow(InternalServerErrorException);
    });

    it('should throw InternalServerErrorException if authorizeUrl is missing', () => {
      mockProviderRegistry.getProvider.mockReturnValue({
        name: 'salesforce',
        authType: 'OAUTH2',
      } as unknown as NonNullable<ProviderResult>);

      expect(() =>
        service.getAuthorizationUrl('salesforce', 'state', 'test-client-id'),
      ).toThrow(InternalServerErrorException);
    });
  });

  describe('exchangeCodeForTokens', () => {
    beforeEach(() => {
      vi.stubGlobal('fetch', vi.fn());
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('should throw BadRequestException if providerName fails validation', async () => {
      await expect(
        service.exchangeCodeForTokens(
          'invalid/provider_name!',
          'auth-code',
          'mock_client_id',
          'mock_client_secret',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException if provider does not exist', async () => {
      mockProviderRegistry.getProvider.mockReturnValue(null);
      await expect(
        service.exchangeCodeForTokens(
          'unknown',
          'auth-code',
          'mock_client_id',
          'mock_client_secret',
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw InternalServerErrorException if authType is not OAUTH2', async () => {
      mockProviderRegistry.getProvider.mockReturnValue({
        name: 'salesforce',
        authType: 'API_KEY',
        tokenUrl: 'https://login.salesforce.com/services/oauth2/token',
      } as unknown as NonNullable<ProviderResult>);

      await expect(
        service.exchangeCodeForTokens(
          'salesforce',
          'auth-code',
          'mock_client_id',
          'mock_client_secret',
        ),
      ).rejects.toThrow(InternalServerErrorException);
    });

    it('should throw InternalServerErrorException if tokenUrl is missing', async () => {
      mockProviderRegistry.getProvider.mockReturnValue({
        name: 'salesforce',
        authType: 'OAUTH2',
      } as unknown as NonNullable<ProviderResult>);

      await expect(
        service.exchangeCodeForTokens(
          'salesforce',
          'auth-code',
          'mock_client_id',
          'mock_client_secret',
        ),
      ).rejects.toThrow(InternalServerErrorException);
    });

    it('should successfully exchange a code for tokens', async () => {
      mockProviderRegistry.getProvider.mockReturnValue({
        name: 'salesforce',
        authType: 'OAUTH2',
        tokenUrl: 'https://login.salesforce.com/services/oauth2/token',
      } as unknown as NonNullable<ProviderResult>);

      const mockTokens = { access_token: 'abc', refresh_token: 'def' };
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockTokens),
      } as Response);

      const result = await service.exchangeCodeForTokens(
        'salesforce',
        'auth-code',
        'mock_client_id',
        'mock_client_secret',
      );

      expect(result).toEqual(mockTokens);

      // Validate fetch call payload
      expect(fetch).toHaveBeenCalledWith(
        'https://login.salesforce.com/services/oauth2/token',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          body: expect.any(String),
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          signal: expect.any(AbortSignal),
        },
      );

      const fetchCallArgs = vi.mocked(fetch).mock.calls[0];
      const fetchBody = fetchCallArgs?.[1]?.body as string;
      expect(fetchBody).toContain('grant_type=authorization_code');
      expect(fetchBody).toContain('client_id=mock_client_id');
      expect(fetchBody).toContain('client_secret=mock_client_secret');
    });

    it('should route to environment specific tokenUrl when env is provided and matched', async () => {
      mockProviderRegistry.getProvider.mockReturnValue({
        name: 'salesforce',
        authType: 'OAUTH2',
        tokenUrl: 'https://login.salesforce.com/services/oauth2/token',
        environments: [
          {
            name: 'sandbox',
            displayName: 'Sandbox',
            tokenUrl: 'https://test.salesforce.com/services/oauth2/token',
          },
        ],
      } as unknown as NonNullable<ProviderResult>);

      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ access_token: 'abc' }),
      } as Response);

      await service.exchangeCodeForTokens(
        'salesforce',
        'code',
        'cl_id',
        'cl_secret',
        'sandbox',
      );

      expect(fetch).toHaveBeenCalledWith(
        'https://test.salesforce.com/services/oauth2/token',
        expect.any(Object),
      );
    });

    it('should throw BadRequestException when env is provided but no match is found', async () => {
      mockProviderRegistry.getProvider.mockReturnValue({
        name: 'salesforce',
        authType: 'OAUTH2',
        tokenUrl: 'https://login.salesforce.com/services/oauth2/token',
        environments: [
          {
            name: 'sandbox',
            displayName: 'Sandbox',
            tokenUrl: 'https://test.salesforce.com/services/oauth2/token',
          },
        ],
      } as unknown as NonNullable<ProviderResult>);

      await expect(
        service.exchangeCodeForTokens(
          'salesforce',
          'code',
          'cl_id',
          'cl_secret',
          'unknown',
        ),
      ).rejects.toThrow(BadRequestException);

      expect(fetch).not.toHaveBeenCalled();
    });

    it('should invoke validateConnectResponse and throw if validation fails', async () => {
      const mockValidate = vi.fn().mockImplementation(() => {
        throw new AppCredentialError('Validation failed');
      });

      mockProviderRegistry.getProvider.mockReturnValue({
        name: 'salesforce',
        authType: 'OAUTH2',
        tokenUrl: 'https://login.salesforce.com/services/oauth2/token',
        validateConnectResponse: mockValidate,
      } as unknown as NonNullable<ProviderResult>);

      const mockTokens = { access_token: 'abc' };
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockTokens),
      } as Response);

      await expect(
        service.exchangeCodeForTokens(
          'salesforce',
          'auth-code',
          'mock_client_id',
          'mock_client_secret',
        ),
      ).rejects.toThrow(AppCredentialError);

      expect(mockValidate).toHaveBeenCalledWith(mockTokens);
    });

    it('should throw InternalServerErrorException if the token exchange fails', async () => {
      mockProviderRegistry.getProvider.mockReturnValue({
        name: 'salesforce',
        authType: 'OAUTH2',
        tokenUrl: 'https://login.salesforce.com/services/oauth2/token',
      } as unknown as NonNullable<ProviderResult>);

      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        status: 400,
        text: () => Promise.resolve('invalid_client'),
      } as Response);

      await expect(
        service.exchangeCodeForTokens(
          'salesforce',
          'bad-code',
          'mock_client_id',
          'mock_client_secret',
        ),
      ).rejects.toThrow(InternalServerErrorException);
    });

    it('should throw InternalServerErrorException on network/timeout errors', async () => {
      mockProviderRegistry.getProvider.mockReturnValue({
        name: 'salesforce',
        authType: 'OAUTH2',
        tokenUrl: 'https://login.salesforce.com/services/oauth2/token',
      } as unknown as NonNullable<ProviderResult>);

      vi.mocked(fetch).mockRejectedValue(new Error('network unreachable'));

      await expect(
        service.exchangeCodeForTokens(
          'salesforce',
          'timeout-code',
          'mock_client_id',
          'mock_client_secret',
        ),
      ).rejects.toThrow(InternalServerErrorException);
    });
  });

  describe('storeOAuthConnection', () => {
    it('should upsert a single connection row on the happy path', async () => {
      await service.storeOAuthConnection({
        tenantId: 'tenant-123',
        providerName: 'salesforce',
        externalId: 'salesforce-tms',
        displayName: 'TMS Salesforce',
        authType: 'OAUTH2',
        value: 'encrypted-value-blob',
        expiresAt: new Date(),
        metadata: { env: 'sandbox' },
      });

      // Single insert on appConnections — no transaction, no second table
      expect(mockDbInsert).toHaveBeenCalledTimes(1);
      expect(mockDbValues).toHaveBeenCalledTimes(1);
      expect(mockDbOnConflictDoUpdate).toHaveBeenCalledTimes(1);

      const insertedValues = vi.mocked(mockDbValues).mock
        .calls[0]?.[0] as Record<string, unknown>;
      expect(insertedValues).toMatchObject({
        tenantId: 'tenant-123',
        appName: 'salesforce',
        externalId: 'salesforce-tms',
        displayName: 'TMS Salesforce',
        authType: 'OAUTH2',
        value: 'encrypted-value-blob',
        metadata: { env: 'sandbox' },
        status: 'ACTIVE',
      });
    });

    it('should throw InternalServerErrorException if the database insert fails', async () => {
      mockDbInsert.mockReturnValue({
        values: vi.fn().mockReturnValue({
          onConflictDoUpdate: vi
            .fn()
            .mockRejectedValue(new Error('DB write failed')),
        }),
      });

      await expect(
        service.storeOAuthConnection({
          tenantId: 'tenant-123',
          providerName: 'salesforce',
          externalId: 'salesforce-tms',
          displayName: 'TMS Salesforce',
          authType: 'OAUTH2',
          value: 'encrypted-value-blob',
          expiresAt: new Date(),
          metadata: { env: 'sandbox' },
        }),
      ).rejects.toThrow(InternalServerErrorException);
    });
  });
});
