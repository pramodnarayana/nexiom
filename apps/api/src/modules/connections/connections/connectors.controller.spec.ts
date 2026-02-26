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
import { AuthGuard } from '../../identity/auth/auth.guard';
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
    where: Mock;
    orderBy: Mock;
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
      verifyState: vi.fn().mockReturnValue({ tenantId: 'tenant-123' }),
    } as unknown as Mocked<OauthStateService>;

    mockEncryptionService = {
      encrypt: vi.fn(),
      decrypt: vi.fn(),
    } as unknown as Mocked<EncryptionService>;

    const dataChain = {
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      offset: vi.fn().mockResolvedValue([]),
    };

    mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnValue(dataChain),
      orderBy: vi.fn().mockReturnThis(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ConnectorsController],
      providers: [
        { provide: ProviderRegistryService, useValue: mockProviderRegistry },
        { provide: ConnectorsService, useValue: mockConnectorsService },
        { provide: OauthStateService, useValue: mockOauthStateService },
        { provide: EncryptionService, useValue: mockEncryptionService },
        { provide: 'DRIZZLE_DB', useValue: mockDb },
        { provide: 'AuthService', useValue: {} },
      ],
    })
      .overrideGuard(AuthGuard)
      .useValue({ canActivate: vi.fn().mockReturnValue(true) })
      .compile();

    controller = module.get<ConnectorsController>(ConnectorsController);
  });

  describe('initiateOAuth', () => {
    it('should create state, build auth URL and redirect', () => {
      const mockRes = {
        redirect: vi.fn(),
        req: { params: { providerName: 'salesforce' } },
      } as unknown as Response;

      mockOauthStateService.generateState.mockReturnValue('mocked_jwt_state');
      mockConnectorsService.getAuthorizationUrl.mockReturnValue(
        'https://vendor.com/auth',
      );

      controller.initiateOAuth(
        mockCtx,
        'salesforce',
        'mock-client-id',
        undefined,
        mockRes,
      );

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
      const mockRes = {
        redirect: vi.fn(),
        req: { params: { providerName: 'salesforce' } },
      } as unknown as Response;

      expect(() =>
        controller.initiateOAuth(
          missingTenantCtx,
          'salesforce',
          'mock-client-id',
          undefined,
          mockRes,
        ),
      ).toThrow(BadRequestException);
    });

    it('should throw BadRequestException if clientId is missing', () => {
      const mockRes = {
        redirect: vi.fn(),
        req: { params: { providerName: 'salesforce' } },
      } as unknown as Response;

      expect(() =>
        controller.initiateOAuth(mockCtx, 'salesforce', '', undefined, mockRes),
      ).toThrow(BadRequestException);
    });

    it('should throw InternalServerErrorException if service fails', () => {
      const mockRes = {
        redirect: vi.fn(),
        req: { params: { providerName: 'salesforce' } },
      } as unknown as Response;

      mockOauthStateService.generateState.mockReturnValue('state');
      mockConnectorsService.getAuthorizationUrl.mockImplementation(() => {
        throw new Error('Config error');
      });

      expect(() =>
        controller.initiateOAuth(
          mockCtx,
          'salesforce',
          'mock-client-id',
          undefined,
          mockRes,
        ),
      ).toThrow(InternalServerErrorException);
    });
  });

  describe('getProviders', () => {
    it('should map provider data exactly as required by the frontend uiSchema', () => {
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

      const result = controller.getProviders();

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        name: 'salesforce',
        displayName: 'Salesforce',
        description: 'CRM platform',
        logoUrl: 'https://logo.com/sf.png',
        authType: 'OAUTH2',
        category: 'CRM',
        environments: undefined,
      });
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
    it('should return active connections with externalId and displayName for the requesting tenant', async () => {
      const mockDate = new Date();
      const mockConnectionRow = {
        id: '1',
        appName: 'salesforce',
        externalId: 'salesforce-tms',
        displayName: 'TMS Salesforce',
        authType: 'OAUTH2' as const,
        status: AppConnectionStatus.ACTIVE,
        value: 'dummy-encrypted-value',
        encryptedCredentials: 'dummy-encrypted-value',
        metadata: { env: 'sandbox' },
        expiresAt: null,
        createdAt: mockDate,
        updatedAt: mockDate,
      };

      const dataChain = {
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        offset: vi.fn().mockResolvedValue([mockConnectionRow]),
      };
      const countPromise = Promise.resolve([{ count: 1 }]);

      mockDb.where
        .mockReturnValueOnce(dataChain)
        .mockReturnValueOnce(countPromise);

      const result = await controller.getActiveConnections(mockCtx);

      expect(mockDb.select).toHaveBeenCalled();
      expect(mockDb.from).toHaveBeenCalled();
      expect(dataChain.limit).toHaveBeenCalledWith(50);
      expect(dataChain.offset).toHaveBeenCalledWith(0);

      const safeMockRow = {
        id: mockConnectionRow.id,
        appName: mockConnectionRow.appName,
        externalId: mockConnectionRow.externalId,
        displayName: mockConnectionRow.displayName,
        authType: mockConnectionRow.authType,
        status: mockConnectionRow.status,
        metadata: mockConnectionRow.metadata,
        expiresAt: mockConnectionRow.expiresAt,
        createdAt: mockConnectionRow.createdAt,
        updatedAt: mockConnectionRow.updatedAt,
      };

      expect(result).toEqual({
        data: [safeMockRow],
        metadata: { limit: 50, offset: 0, count: 1 },
      });

      // No credentials JOIN — value is encrypted and never returned to client
      expect(result.data[0]).not.toHaveProperty('value');
      expect(result.data[0]).not.toHaveProperty('encryptedCredentials');
      expect(result.data[0]).toHaveProperty('externalId', 'salesforce-tms');
      expect(result.data[0]).toHaveProperty('displayName', 'TMS Salesforce');
    });

    it('should throw BadRequestException if tenantId is missing', async () => {
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
      state: 'valid-state',
      displayName: 'TMS Salesforce',
      env: 'sandbox',
    };

    const mockTokenResponse = {
      access_token: 'access-123',
      refresh_token: 'refresh-123',
      expires_in: 3600,
    };

    it('should successfully exchange the code and store a single connection row', async () => {
      mockProviderRegistry.getProvider.mockReturnValue({
        authType: 'OAUTH2',
      } as unknown as ProviderDefinition);
      mockConnectorsService.exchangeCodeForTokens.mockResolvedValue(
        mockTokenResponse,
      );
      mockEncryptionService.encrypt.mockResolvedValue('encrypted-value-blob');
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
      expect(mockOauthStateService.verifyState).toHaveBeenCalledWith(
        'valid-state',
        'salesforce',
      );
      // Single encrypt call — value blob contains clientId, clientSecret, tokens
      expect(mockEncryptionService.encrypt).toHaveBeenCalledTimes(1);
      expect(mockEncryptionService.encrypt).toHaveBeenCalledWith(
        expect.stringContaining('access-123'),
      );
      expect(mockConnectorsService.storeOAuthConnection).toHaveBeenCalledWith({
        tenantId: 'tenant-123',
        providerName: 'salesforce',
        externalId: 'salesforce-tms-salesforce', // auto-generated kebab slug (namespaced)
        displayName: 'TMS Salesforce',
        authType: 'OAUTH2',
        value: 'encrypted-value-blob',
        expiresAt: expect.any(Date) as unknown as Date,
        metadata: { env: 'sandbox' },
      });
    });

    it('should throw BadRequestException for missing required body fields', async () => {
      const invalidBody = { ...validBody, code: '' };
      await expect(
        controller.exchangeCode(mockCtx, invalidBody),
      ).rejects.toThrow(
        new BadRequestException('Missing required fields inside body'),
      );
    });

    it('should throw BadRequestException if displayName is missing', async () => {
      const invalidBody = { ...validBody, displayName: '' };
      await expect(
        controller.exchangeCode(mockCtx, invalidBody),
      ).rejects.toThrow(new BadRequestException('displayName is required'));
    });

    it('should throw BadRequestException if provider name format is invalid', async () => {
      const invalidBody = { ...validBody, providerName: 'Invalid Name!' };
      await expect(
        controller.exchangeCode(mockCtx, invalidBody),
      ).rejects.toThrow(
        new BadRequestException('Invalid provider name format'),
      );
    });

    it('should throw BadRequestException if provider is not registered', async () => {
      await expect(controller.exchangeCode(mockCtx, validBody)).rejects.toThrow(
        new BadRequestException('Invalid provider name'),
      );
    });

    it('should throw BadRequestException if verifyState throws', async () => {
      mockProviderRegistry.getProvider.mockReturnValue({
        authType: 'OAUTH2',
      } as unknown as ProviderDefinition);
      mockOauthStateService.verifyState.mockImplementationOnce(() => {
        throw new BadRequestException('Invalid state signature');
      });

      await expect(controller.exchangeCode(mockCtx, validBody)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException if state token does not belong to this tenant', async () => {
      mockProviderRegistry.getProvider.mockReturnValue({
        authType: 'OAUTH2',
      } as unknown as ProviderDefinition);
      mockOauthStateService.verifyState.mockReturnValueOnce({
        tenantId: 'other-tenant',
      });

      await expect(controller.exchangeCode(mockCtx, validBody)).rejects.toThrow(
        new BadRequestException('State token does not belong to this tenant'),
      );
    });

    it('should throw InternalServerErrorException if exchangeCodeForTokens throws', async () => {
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

    it('should throw InternalServerErrorException if encrypt throws', async () => {
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

    it('should propagate HttpException as-is if storeOAuthConnection fails', async () => {
      mockProviderRegistry.getProvider.mockReturnValue({
        authType: 'OAUTH2',
      } as unknown as ProviderDefinition);
      mockConnectorsService.exchangeCodeForTokens.mockResolvedValue(
        mockTokenResponse,
      );
      mockEncryptionService.encrypt.mockResolvedValue('encrypted');
      mockConnectorsService.storeOAuthConnection.mockRejectedValue(
        new BadRequestException('Invalid connection slug'),
      );
      await expect(controller.exchangeCode(mockCtx, validBody)).rejects.toThrow(
        new BadRequestException('Invalid connection slug'),
      );
    });

    it('should sanitize generic Errors thrown by storeOAuthConnection into InternalServerErrorException', async () => {
      mockProviderRegistry.getProvider.mockReturnValue({
        authType: 'OAUTH2',
      } as unknown as ProviderDefinition);
      mockConnectorsService.exchangeCodeForTokens.mockResolvedValue(
        mockTokenResponse,
      );
      mockEncryptionService.encrypt.mockResolvedValue('encrypted');
      mockConnectorsService.storeOAuthConnection.mockRejectedValue(
        new Error('some internal failure'),
      );
      await expect(controller.exchangeCode(mockCtx, validBody)).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });
});
