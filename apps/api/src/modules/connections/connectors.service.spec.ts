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

    it('should generate a valid OAuth authorization URL with state and scopes', async () => {
      mockProviderRegistry.getProvider.mockReturnValue({
        name: 'salesforce',
        authType: 'OAUTH2',
        authorizeUrl: 'https://login.salesforce.com/services/oauth2/authorize',
        scopes: ['api', 'refresh_token'],
      } as unknown as NonNullable<ProviderResult>);

      const urlString = await service.getAuthorizationUrl(
        'salesforce',
        'mocked_jwt_state',
        testTenantId,
      );

      const parsedUrl = new URL(urlString);
      expect(parsedUrl.origin).toBe('https://login.salesforce.com');
      expect(parsedUrl.pathname).toBe('/services/oauth2/authorize');

      const searchParams = parsedUrl.searchParams;
      expect(searchParams.get('response_type')).toBe('code');
      expect(searchParams.get('client_id')).toBe('test-client-id');
      expect(searchParams.get('state')).toBe('mocked_jwt_state');
      expect(searchParams.get('scope')).toBe('api refresh_token');
      expect(searchParams.get('redirect_uri')).toBe(
        'https://tenant.nexiom.app/api/connect/salesforce/callback',
      );
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

      mockEncryptionService.decrypt.mockImplementation(() => {
        throw new Error('decryption failed');
      });

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
      expect(fetch).toHaveBeenCalledWith(
        'https://login.salesforce.com/services/oauth2/token',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          body: expect.stringContaining('grant_type=authorization_code'),
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          signal: expect.any(AbortSignal),
        },
      );
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
