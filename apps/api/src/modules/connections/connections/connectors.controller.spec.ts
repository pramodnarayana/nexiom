/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { ConnectorsController } from './connectors.controller.js';
import {
  ProviderRegistryService,
  EncryptionService,
  ProviderDefinition,
} from '@nexiom/connections';
import { ConnectorsService } from '../connectors.service';
import { OauthStateService } from '../oauth-state.service';
import { AppConnectionStatus } from '@nexiom/database';
import {
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import {
  describe,
  it,
  expect,
  beforeEach,
  vi,
  type Mocked,
  type Mock,
} from 'vitest';
import { AuthGuard } from '../../identity/auth/auth.guard'; // Assume this is the path based on standard layout
import type { Response } from 'express';
import type { RequestAuthContext } from '../../identity/auth/auth-context.decorator';

const mockCtx = {
  user: {
    organizationId: 'tenant-123',
  },
} as unknown as RequestAuthContext;

const missingTenantCtx = {
  user: {},
} as unknown as RequestAuthContext;

describe('ConnectorsController', () => {
  let controller: ConnectorsController;
  let mockProviderRegistry: Mocked<ProviderRegistryService>;
  let mockConnectorsService: Mocked<ConnectorsService>;
  let mockOauthStateService: Mocked<OauthStateService>;
  let mockEncryptionService: Mocked<EncryptionService>;
  let mockDb: {
    select: Mock;
    from: Mock;
    leftJoin: Mock;
    where: Mock;
  };

  beforeEach(async () => {
    mockProviderRegistry = {
      getAllProviders: vi.fn(),
      getProvider: vi.fn(),
      isAllowed: vi.fn(),
    } as unknown as Mocked<ProviderRegistryService>;

    mockConnectorsService = {
      getAuthorizationUrl: vi.fn(),
      exchangeCodeForTokens: vi.fn(),
      storeOAuthConnection: vi.fn(),
    } as unknown as Mocked<ConnectorsService>;

    mockOauthStateService = {
      generateState: vi.fn(),
      verifyState: vi.fn(),
    } as unknown as Mocked<OauthStateService>;

    mockEncryptionService = {
      encrypt: vi.fn(),
      decrypt: vi.fn(),
    } as unknown as Mocked<EncryptionService>;

    // Create two separate chain variables to easily assert against
    const dataChain = {
      limit: vi.fn().mockReturnThis(),
      offset: vi.fn().mockResolvedValue([]),
    };

    // Default the `where` mock to return the data chain
    mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      leftJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnValue(dataChain),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ConnectorsController],
      providers: [
        { provide: ProviderRegistryService, useValue: mockProviderRegistry },
        { provide: ConnectorsService, useValue: mockConnectorsService },
        { provide: OauthStateService, useValue: mockOauthStateService },
        { provide: EncryptionService, useValue: mockEncryptionService },
        { provide: 'DRIZZLE_DB', useValue: mockDb },
        // If AuthGuard is globally applied or injected at controller level, provide a dummy AuthService
        { provide: 'AuthService', useValue: {} },
      ],
    })
      .overrideGuard(AuthGuard) // Attempt to override if it's explicitly imported
      .useValue({ canActivate: vi.fn().mockReturnValue(true) })
      .compile();

    controller = module.get<ConnectorsController>(ConnectorsController);
  });

  describe('connect', () => {
    it('should generate state, get auth url and redirect', () => {
      const mockRes = { redirect: vi.fn() } as unknown as Response;

      mockOauthStateService.generateState.mockReturnValue('mocked_jwt_state');
      mockConnectorsService.getAuthorizationUrl.mockReturnValue(
        'https://vendor.com/auth',
      );

      controller.connect('salesforce', mockCtx, 'mock-client-id', mockRes);

      expect(mockOauthStateService.generateState).toHaveBeenCalledWith(
        'tenant-123',
        'salesforce',
        undefined,
      );
      expect(mockConnectorsService.getAuthorizationUrl).toHaveBeenCalledWith(
        'salesforce',
        'mocked_jwt_state',
        'mock-client-id',
        undefined,
      );
      expect(mockRes.redirect).toHaveBeenCalledWith('https://vendor.com/auth');
    });

    it('should throw BadRequestException if tenant is missing', () => {
      const mockRes = { redirect: vi.fn() } as unknown as Response;

      expect(() =>
        controller.connect(
          'salesforce',
          missingTenantCtx,
          'mock-client-id',
          mockRes,
        ),
      ).toThrow(BadRequestException);
    });

    it('should throw BadRequestException if clientId is missing', () => {
      const mockRes = { redirect: vi.fn() } as unknown as Response;

      expect(() =>
        controller.connect('salesforce', mockCtx, '', mockRes),
      ).toThrow(BadRequestException);
    });

    it('should bubble up InternalServerErrorException if service fails', () => {
      const mockRes = { redirect: vi.fn() } as unknown as Response;

      mockOauthStateService.generateState.mockReturnValue('state');
      mockConnectorsService.getAuthorizationUrl.mockImplementation(() => {
        throw new Error('Config error');
      });

      expect(() =>
        controller.connect('salesforce', mockCtx, 'mock-client-id', mockRes),
      ).toThrow(InternalServerErrorException);
    });
  });

  describe('getProviders', () => {
    it('should map provider data exactly as required by the frontend uiSchema', () => {
      // Arrange
      (mockProviderRegistry.getAllProviders as Mock).mockReturnValue([
        {
          name: 'salesforce',
          displayName: 'Salesforce',
          authType: 'OAUTH2',
          description: 'CRM platform',
          logoUrl: 'https://logo.com/sf.png',
          category: 'CRM',
          scopes: [],
          uiSchema: {},
          authorizeUrl: '',
          tokenUrl: '',
        },
      ]);

      // Act
      const result = controller.getProviders();

      // Assert
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        name: 'salesforce',
        displayName: 'Salesforce',
        description: 'CRM platform',
        logoUrl: 'https://logo.com/sf.png',
        authType: 'OAUTH2',
        category: 'CRM',
      });
      // Ensure backend-only secrets like authorizeUrl/tokenUrl are stripped
      expect(result[0]).not.toHaveProperty('tokenUrl');
      expect(result[0]).not.toHaveProperty('authorizeUrl');
    });

    it('should bubble up InternalServerErrorException from the provider registry', () => {
      mockProviderRegistry.getAllProviders.mockImplementation(() => {
        throw new Error('Registry initialization error');
      });

      try {
        controller.getProviders();
        expect.unreachable('Should have thrown an exception');
      } catch (error) {
        expect(error).toBeInstanceOf(InternalServerErrorException);
        expect((error as Error).message).toContain('Failed to get providers');
      }
    });
  });

  describe('getActiveConnections', () => {
    it('should return active connections for the requesting tenant', async () => {
      const mockDate = new Date();
      const mockConnectionInfo = {
        id: '1',
        appName: 'salesforce',
        status: AppConnectionStatus.ACTIVE,
        metadata: { some: 'metadata' },
        credentialClientId: 'client-123',
        credentialEncryptedSecret: 'secret_leak',
        credentialSetupMetadata: { env: 'sandbox' },
        createdAt: mockDate,
        updatedAt: mockDate,
      };

      const {
        credentialClientId: _credentialClientId,
        credentialEncryptedSecret: _credentialEncryptedSecret,
        credentialSetupMetadata: _credentialSetupMetadata,
        ...restOfData
      } = mockConnectionInfo;

      const expectedData = {
        ...restOfData,
        credentials: {
          clientId: 'client-123',
          env: 'sandbox',
        },
      };

      // The controller calls where() twice: once for data, once for count.
      const dataChain = {
        limit: vi.fn().mockReturnThis(),
        offset: vi.fn().mockResolvedValue([mockConnectionInfo]),
      };

      const countPromise = Promise.resolve([{ count: 1 }]);

      // First call gets dataChain, second call gets countPromise
      mockDb.where
        .mockReturnValueOnce(dataChain)
        .mockReturnValueOnce(countPromise);

      const result = await controller.getActiveConnections(mockCtx);

      expect(mockDb.select).toHaveBeenCalled();
      expect(mockDb.from).toHaveBeenCalled();

      expect(dataChain.limit).toHaveBeenCalledWith(50);
      expect(dataChain.offset).toHaveBeenCalledWith(0);

      expect(mockDb.where).toHaveBeenCalledTimes(2);
      expect(mockDb.where).toHaveBeenNthCalledWith(
        1,
        expect.any(Object), // Represents the drizzle 'and' clause for data
      );
      expect(mockDb.where).toHaveBeenNthCalledWith(
        2,
        expect.any(Object), // Represents the drizzle 'and' clause for count
      );

      expect(result).toEqual({
        data: [expectedData],
        metadata: { limit: 50, offset: 0, count: 1 },
      });

      expect(result.data[0]).not.toHaveProperty('credentialEncryptedSecret');
      expect(result.data[0]).not.toHaveProperty('encryptedCredentials');
      expect((result.data[0] as { credentials: any }).credentials).toEqual({
        clientId: 'client-123',
        env: 'sandbox',
      });
    });

    it('should throw an error if tenantId is missing from the request', async () => {
      await expect(
        controller.getActiveConnections(missingTenantCtx, '50', '0'),
      ).rejects.toThrow(new BadRequestException('tenantId context is missing'));
    });
  });

  describe('exchangeCode', () => {
    const validBody = {
      providerName: 'salesforce',
      code: 'auth-code-123',
      clientId: 'client-123',
      clientSecret: 'secret-123',
      realmId: 'realm-1',
      env: 'sandbox',
    };

    const mockTokenResponse = {
      access_token: 'access-123',
      refresh_token: 'refresh-123',
      expires_in: 3600,
    };

    it('should successfully exchange the code and store connection/credentials', async () => {
      // 1. Happy path
      mockProviderRegistry.getProvider.mockReturnValue({
        authType: 'OAUTH2',
      } as unknown as ProviderDefinition);
      mockConnectorsService.exchangeCodeForTokens.mockResolvedValue(
        mockTokenResponse,
      );
      mockEncryptionService.encrypt.mockResolvedValue('encrypted-output');
      mockConnectorsService.storeOAuthConnection.mockResolvedValue(undefined);

      const result = await controller.exchangeCode(mockCtx, validBody);

      expect(result).toEqual({ success: true });
      expect(mockConnectorsService.exchangeCodeForTokens).toHaveBeenCalledWith(
        'salesforce',
        'auth-code-123',
        'client-123',
        'secret-123',
        'sandbox',
      );
      expect(mockEncryptionService.encrypt).toHaveBeenCalledWith(
        expect.stringContaining('access-123'),
      );
      expect(mockConnectorsService.storeOAuthConnection).toHaveBeenCalledWith(
        'tenant-123',
        'salesforce',
        'realm-1',
        'OAUTH2',
        'encrypted-output', // encrypted payload
        expect.any(Date),
        { realmId: 'realm-1', env: 'sandbox' },
        'client-123',
        'encrypted-output', // encrypted secret
        'sandbox',
      );
    });

    it('should assert BadRequestException for missing required body fields', async () => {
      // 2. validation failures
      const invalidBody = { ...validBody, code: '' };

      await expect(
        controller.exchangeCode(mockCtx, invalidBody),
      ).rejects.toThrow(
        new BadRequestException('Missing required fields inside body'),
      );
    });

    it('should throw BadRequestException if provider is not registered', async () => {
      // 3. invalid/non-registered provider
      mockProviderRegistry.getProvider.mockReturnValue(undefined);

      await expect(controller.exchangeCode(mockCtx, validBody)).rejects.toThrow(
        new BadRequestException('Invalid provider name'),
      );
    });

    it('should throw InternalServerErrorException if exchangeCodeForTokens throws', async () => {
      // 4. connectorsService.exchangeCode throwing
      mockProviderRegistry.getProvider.mockReturnValue({
        authType: 'OAUTH2',
      } as unknown as ProviderDefinition);
      mockConnectorsService.exchangeCodeForTokens.mockRejectedValue(
        new Error('Network error'),
      );

      await expect(controller.exchangeCode(mockCtx, validBody)).rejects.toThrow(
        new InternalServerErrorException('Failed to exchange auth code'),
      );
    });

    it('should throw InternalServerErrorException if encryptCredentials throws for payload', async () => {
      // 5. cryptoService.encrypt throwing
      mockProviderRegistry.getProvider.mockReturnValue({
        authType: 'OAUTH2',
      } as unknown as ProviderDefinition);
      mockConnectorsService.exchangeCodeForTokens.mockResolvedValue(
        mockTokenResponse,
      );
      mockEncryptionService.encrypt.mockRejectedValueOnce(
        new Error('Encryption error'),
      );

      await expect(controller.exchangeCode(mockCtx, validBody)).rejects.toThrow(
        new InternalServerErrorException('Failed to encrypt credentials'),
      );
    });

    it('should bubble up error if storeOAuthConnection string fails', async () => {
      // 6. DB DB transaction/upsert failures
      mockProviderRegistry.getProvider.mockReturnValue({
        authType: 'OAUTH2',
      } as unknown as ProviderDefinition);
      mockConnectorsService.exchangeCodeForTokens.mockResolvedValue(
        mockTokenResponse,
      );
      mockEncryptionService.encrypt.mockResolvedValue('encrypted');
      mockConnectorsService.storeOAuthConnection.mockRejectedValue(
        new Error('Database transaction failure'),
      );

      await expect(controller.exchangeCode(mockCtx, validBody)).rejects.toThrow(
        'Database transaction failure',
      );
    });
  });
});
