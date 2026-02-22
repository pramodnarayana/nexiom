import { Test, TestingModule } from '@nestjs/testing';
import { ConnectorsService } from './connectors.service';
import { ProviderRegistryService } from '@nexiom/connections';
import {
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { vi, describe, it, expect, beforeEach, Mocked } from 'vitest';

type ProviderResult = Awaited<
  ReturnType<ProviderRegistryService['getProvider']>
>;

describe('ConnectorsService', () => {
  let service: ConnectorsService;
  let mockProviderRegistry: Mocked<ProviderRegistryService>;

  beforeEach(async () => {
    mockProviderRegistry = {
      getProvider: vi.fn(),
      getAllProviders: vi.fn(),
    } as unknown as Mocked<ProviderRegistryService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConnectorsService,
        { provide: ProviderRegistryService, useValue: mockProviderRegistry },
      ],
    }).compile();

    service = module.get<ConnectorsService>(ConnectorsService);

    // Reset env vars cleanly
    delete process.env.SALESFORCE_CLIENT_ID;
    delete process.env.SALESFORCE_CLIENT_SECRET;
    delete process.env.BASE_URL;
  });

  describe('getAuthorizationUrl', () => {
    it('should generate a valid OAuth authorization URL with state and scopes', async () => {
      mockProviderRegistry.getProvider.mockResolvedValue({
        id: '1',
        name: 'salesforce',
        authorizeUrl: 'https://login.salesforce.com/services/oauth2/authorize',
        scopes: ['api', 'refresh_token'],
      } as ProviderResult);

      process.env.SALESFORCE_CLIENT_ID = 'test-client-id';
      process.env.BASE_URL = 'https://tenant.nexiom.app';

      const urlString = await service.getAuthorizationUrl(
        'salesforce',
        'mocked_jwt_state',
      );

      expect(urlString).toBe(
        'https://login.salesforce.com/services/oauth2/authorize?response_type=code&client_id=test-client-id&state=mocked_jwt_state&scope=api+refresh_token&redirect_uri=https%3A%2F%2Ftenant.nexiom.app%2Fapi%2Fconnect%2Fsalesforce%2Fcallback',
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

      // Deliberately omit env var
      await expect(
        service.getAuthorizationUrl('salesforce', 'state'),
      ).rejects.toThrow(InternalServerErrorException);
    });
  });

  describe('exchangeCodeForTokens', () => {
    beforeEach(() => {
      vi.stubGlobal('fetch', vi.fn());
    });

    it('should successfully exchange a code for tokens', async () => {
      mockProviderRegistry.getProvider.mockResolvedValue({
        id: '1',
        name: 'salesforce',
        tokenUrl: 'https://login.salesforce.com/services/oauth2/token',
      } as ProviderResult);

      process.env.SALESFORCE_CLIENT_ID = 'client-123';
      process.env.SALESFORCE_CLIENT_SECRET = 'secret-456';

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

      process.env.SALESFORCE_CLIENT_ID = 'client-123';
      process.env.SALESFORCE_CLIENT_SECRET = 'secret-456';

      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        status: 400,
        text: () => Promise.resolve('invalid_client'),
      } as Response);

      await expect(
        service.exchangeCodeForTokens('salesforce', 'bad-code'),
      ).rejects.toThrow(InternalServerErrorException);
    });
  });
});
