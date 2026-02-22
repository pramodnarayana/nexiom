import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ConnectorsService } from './connectors.service';
import { ProviderRegistryService } from '@nexiom/connections';
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

type ProviderResult = Awaited<
  ReturnType<ProviderRegistryService['getProvider']>
>;

describe('ConnectorsService', () => {
  let service: ConnectorsService;
  let mockProviderRegistry: Mocked<ProviderRegistryService>;
  let mockConfig: Record<string, string>;

  beforeEach(async () => {
    mockConfig = {
      SALESFORCE_CLIENT_ID: 'test-client-id',
      SALESFORCE_CLIENT_SECRET: 'test-client-secret',
      BASE_URL: 'https://tenant.nexiom.app',
    };

    const mockConfigService = {
      get: vi.fn().mockImplementation((key: string) => mockConfig[key]),
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
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should generate a valid OAuth authorization URL with state and scopes', async () => {
      mockProviderRegistry.getProvider.mockResolvedValue({
        id: '1',
        name: 'salesforce',
        authorizeUrl: 'https://login.salesforce.com/services/oauth2/authorize',
        scopes: ['api', 'refresh_token'],
      } as ProviderResult);

      const urlString = await service.getAuthorizationUrl(
        'salesforce',
        'mocked_jwt_state',
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
      mockProviderRegistry.getProvider.mockResolvedValue(null);
      await expect(
        service.getAuthorizationUrl('unknown', 'state'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw InternalServerErrorException if clientId is missing in env', async () => {
      mockProviderRegistry.getProvider.mockResolvedValue({
        id: '1',
        name: 'salesforce',
        authorizeUrl: 'https://login.salesforce.com/services/oauth2/authorize',
      } as ProviderResult);

      mockConfig.SALESFORCE_CLIENT_ID = '';

      await expect(
        service.getAuthorizationUrl('salesforce', 'state'),
      ).rejects.toThrow(InternalServerErrorException);
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
        service.exchangeCodeForTokens('invalid/provider_name!', 'auth-code'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException if provider does not exist', async () => {
      mockProviderRegistry.getProvider.mockResolvedValue(null);
      await expect(
        service.exchangeCodeForTokens('unknown', 'auth-code'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw InternalServerErrorException if credentials are missing', async () => {
      mockProviderRegistry.getProvider.mockResolvedValue({
        id: '1',
        name: 'salesforce',
        tokenUrl: 'https://login.salesforce.com/services/oauth2/token',
      } as ProviderResult);

      mockConfig.SALESFORCE_CLIENT_ID = '';
      mockConfig.SALESFORCE_CLIENT_SECRET = '';

      await expect(
        service.exchangeCodeForTokens('salesforce', 'auth-code'),
      ).rejects.toThrow(InternalServerErrorException);
    });

    it('should successfully exchange a code for tokens', async () => {
      mockProviderRegistry.getProvider.mockResolvedValue({
        id: '1',
        name: 'salesforce',
        tokenUrl: 'https://login.salesforce.com/services/oauth2/token',
      } as ProviderResult);

      const mockTokens = { access_token: 'abc', refresh_token: 'def' };
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockTokens),
      } as Response);

      const result = await service.exchangeCodeForTokens(
        'salesforce',
        'auth-code',
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
      mockProviderRegistry.getProvider.mockResolvedValue({
        id: '1',
        name: 'salesforce',
        tokenUrl: 'https://login.salesforce.com/services/oauth2/token',
      } as ProviderResult);

      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        status: 400,
        text: () => Promise.resolve('invalid_client'),
      } as Response);

      await expect(
        service.exchangeCodeForTokens('salesforce', 'bad-code'),
      ).rejects.toThrow(InternalServerErrorException);
    });

    it('should throw InternalServerErrorException on network/timeout errors', async () => {
      mockProviderRegistry.getProvider.mockResolvedValue({
        id: '1',
        name: 'salesforce',
        tokenUrl: 'https://login.salesforce.com/services/oauth2/token',
      } as ProviderResult);

      vi.mocked(fetch).mockRejectedValue(new Error('network unreachable'));

      await expect(
        service.exchangeCodeForTokens('salesforce', 'timeout-code'),
      ).rejects.toThrow(InternalServerErrorException);
    });
  });
});
