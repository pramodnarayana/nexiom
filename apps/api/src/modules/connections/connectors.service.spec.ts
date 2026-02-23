import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ConnectorsService } from './connectors.service';
import {
  ProviderRegistryService,
  EncryptionService,
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

const safeStringify = (obj: unknown): string =>
  JSON.stringify(obj, (key: string, value: unknown) =>
    key === 'table' ? undefined : value,
  );
type ProviderResult = ReturnType<ProviderRegistryService['getProvider']>;

describe('ConnectorsService', () => {
  let service: ConnectorsService;
  let mockProviderRegistry: Mocked<ProviderRegistryService>;
  let mockEncryptionService: Mocked<EncryptionService>;
  let mockDbWhere: ReturnType<typeof vi.fn>;
  let mockDb: {
    select: ReturnType<typeof vi.fn>;
    from: ReturnType<typeof vi.fn>;
    where: ReturnType<typeof vi.fn>;
  };
  const testTenantId = 'tenant-123';

  beforeEach(async () => {
    mockDbWhere = vi.fn().mockResolvedValue([
      {
        clientId: 'test-client-id',
        encryptedClientSecret: 'encrypted-secret',
      },
    ]);
    mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: mockDbWhere,
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
    it('should throw BadRequestException if providerName fails validation', async () => {
      await expect(
        service.getAuthorizationUrl(
          'invalid/provider_name!',
          'mocked_jwt_state',
          testTenantId,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should generate a valid OAuth URL with scopes', async () => {
      mockProviderRegistry.getProvider.mockReturnValue({
        name: 'salesforce',
        authType: 'OAUTH2',
        authorizeUrl: 'https://login.salesforce.com/services/oauth2/authorize',
        scopes: ['full', 'refresh_token'],
      } as unknown as NonNullable<ProviderResult>);

      const result = await service.getAuthorizationUrl(
        'salesforce',
        'random-state-123',
        testTenantId,
      );

      const url = new URL(result);
      expect(url.origin).toBe('https://login.salesforce.com');
      expect(url.pathname).toBe('/services/oauth2/authorize');
      expect(url.searchParams.get('response_type')).toBe('code');
      expect(url.searchParams.get('client_id')).toBe('test-client-id');
      expect(url.searchParams.get('state')).toBe('random-state-123');
      expect(url.searchParams.get('scope')).toBe('full refresh_token');
      expect(url.searchParams.get('redirect_uri')).toBe(
        'https://tenant.nexiom.app/api/connect/salesforce/callback',
      );

      expect(mockDb.select).toHaveBeenCalled();
      expect(mockDb.from).toHaveBeenCalled();
      expect(mockDbWhere).toHaveBeenCalledWith(expect.any(Object));
      const whereArg = mockDbWhere.mock.calls[0]?.[0] as unknown;
      // Asserting Drizzle ORM's shape loosely, omitting table to prevent circular JSON errors
      expect(safeStringify(whereArg)).toContain('tenant_id');
    });

    it('should throw NotFoundException if provider does not exist', async () => {
      mockProviderRegistry.getProvider.mockReturnValue(null);
      await expect(
        service.getAuthorizationUrl('unknown', 'state', testTenantId),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException if credential is missing in db', async () => {
      mockProviderRegistry.getProvider.mockReturnValue({
        name: 'salesforce',
        authType: 'OAUTH2',
        authorizeUrl: 'https://login.salesforce.com/services/oauth2/authorize',
      } as unknown as NonNullable<ProviderResult>);

      mockDbWhere.mockResolvedValue([]); // No credential found

      await expect(
        service.getAuthorizationUrl('salesforce', 'state', testTenantId),
      ).rejects.toThrow(NotFoundException);
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
          testTenantId,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException if provider does not exist', async () => {
      mockProviderRegistry.getProvider.mockReturnValue(null);
      await expect(
        service.exchangeCodeForTokens('unknown', 'auth-code', testTenantId),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException if credentials are missing in db', async () => {
      mockProviderRegistry.getProvider.mockReturnValue({
        name: 'salesforce',
        authType: 'OAUTH2',
        tokenUrl: 'https://login.salesforce.com/services/oauth2/token',
      } as unknown as NonNullable<ProviderResult>);

      mockDbWhere.mockResolvedValue([]); // No credential found

      await expect(
        service.exchangeCodeForTokens('salesforce', 'auth-code', testTenantId),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw InternalServerErrorException if decryption fails', async () => {
      mockProviderRegistry.getProvider.mockReturnValue({
        name: 'salesforce',
        authType: 'OAUTH2',
        tokenUrl: 'https://login.salesforce.com/services/oauth2/token',
      } as unknown as NonNullable<ProviderResult>);

      mockEncryptionService.decrypt.mockRejectedValue(
        new Error('decryption failed'),
      );

      await expect(
        service.exchangeCodeForTokens('salesforce', 'auth-code', testTenantId),
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
        testTenantId,
      );

      expect(result).toEqual(mockTokens);

      // Verify tenant isolation DB call shape
      expect(mockDbWhere).toHaveBeenCalledWith(expect.any(Object));
      const whereArg = mockDbWhere.mock.calls[0]?.[0] as unknown;
      expect(safeStringify(whereArg)).toContain('tenant_id');

      // Verify the decryption is used based off retrieved DB row
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(mockEncryptionService.decrypt).toHaveBeenCalledWith(
        'encrypted-secret',
      );

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
      expect(fetchBody).toContain('client_id=test-client-id');
      expect(fetchBody).toContain('client_secret=test-client-secret');
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
        service.exchangeCodeForTokens('salesforce', 'bad-code', testTenantId),
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
          testTenantId,
        ),
      ).rejects.toThrow(InternalServerErrorException);
    });
  });
});
