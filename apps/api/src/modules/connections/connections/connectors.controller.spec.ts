/* eslint-disable @typescript-eslint/no-unused-vars, @typescript-eslint/no-unsafe-assignment */
import type { Piece } from '@soopa/piece-framework';
/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { OAuthController } from './oauth.controller.js';
import { CredentialController } from './credential.controller.js';
import { EncryptionService } from '@soopa/credentials';
import { OAuthOrchestrationService } from '../services/oauth-orchestration.service.js';
import { CredentialLinkingService } from '../services/credential-linking.service.js';
import { OauthStateService } from '../oauth-state.service.js';
import { AppConnectionStatus, DATABASE_CONNECTION } from '@soopa/database';
import { REDIS_CLIENT, type Redis } from '@soopa/cache';
import {
  BadRequestException,
  InternalServerErrorException,
  NotFoundException,
  UnauthorizedException,
  HttpException,
  ForbiddenException,
} from '@nestjs/common';
import { PieceRegistryService, PIECES } from '@soopa/piece-registry';
import {
  describe,
  it,
  expect,
  beforeEach,
  vi,
  type Mocked,
  type Mock,
} from 'vitest';
import { AuthGuard, type RequestAuthContext } from '@soopa/auth';
import type { Response } from 'express';

const mockCtx = {
  user: {
    id: 'user-123',
    organizationId: 'tenant-123',
  },
} as unknown as RequestAuthContext;

const missingTenantCtx = {
  user: {
    id: 'user-123',
  },
} as unknown as RequestAuthContext;

describe('Connections Controllers', () => {
  let oauthController: OAuthController;
  let credentialController: CredentialController;
  let mockPieceRegistry: Mocked<PieceRegistryService>;
  let mockOAuthOrchestrationService: Mocked<OAuthOrchestrationService>;
  let mockCredentialLinkingService: Mocked<CredentialLinkingService>;
  let mockOauthStateService: Mocked<OauthStateService>;
  let mockEncryptionService: Mocked<EncryptionService>;
  let mockRedis: Mocked<Redis>;
  let mockDb: {
    select: Mock;
    from: Mock;
    where: Mock;
    orderBy: Mock;

    [key: string]: any;
  };

  beforeEach(async () => {
    mockPieceRegistry = {
      getAllPieces: vi.fn(),
      getPiece: vi.fn(),
      resolveBasePieceName: vi.fn().mockImplementation((x: string) => x),
    } as unknown as Mocked<PieceRegistryService>;

    mockOAuthOrchestrationService = {
      getAuthorizationUrl: vi.fn(),
      exchangeCodeForTokens: vi.fn(),
      getProviderDefinition: vi.fn().mockReturnValue(null),
    } as unknown as Mocked<OAuthOrchestrationService>;

    mockCredentialLinkingService = {
      storeOAuthConnection: vi.fn(),
      deleteConnection: vi.fn(),
    } as unknown as Mocked<CredentialLinkingService>;

    mockOauthStateService = {
      createPreFlightSession: vi.fn(),
      consumePreFlightSession: vi.fn(),
      generateState: vi.fn(),
      verifyState: vi.fn().mockReturnValue({ tenantId: 'tenant-123' }),
    } as unknown as Mocked<OauthStateService>;

    mockEncryptionService = {
      encrypt: vi.fn(),
      decrypt: vi.fn(),
    } as unknown as Mocked<EncryptionService>;

    mockRedis = {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue('OK'),
      del: vi.fn().mockResolvedValue(1),
      // Add other mocked methods if needed or use as unknown as Mocked<Redis>
    } as unknown as Mocked<Redis>;

    const dataChain = {
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      offset: vi.fn().mockResolvedValue([]),
    };

    mockDb = {
      select: vi.fn().mockReturnThis(),
      innerJoin: vi.fn().mockReturnThis(),
      leftJoin: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnValue(dataChain),
      orderBy: vi.fn().mockReturnThis(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [OAuthController, CredentialController],
      providers: [
        { provide: PieceRegistryService, useValue: mockPieceRegistry },
        {
          provide: OAuthOrchestrationService,
          useValue: mockOAuthOrchestrationService,
        },
        {
          provide: CredentialLinkingService,
          useValue: mockCredentialLinkingService,
        },
        { provide: OauthStateService, useValue: mockOauthStateService },
        { provide: EncryptionService, useValue: mockEncryptionService },
        { provide: DATABASE_CONNECTION, useValue: mockDb },
        { provide: REDIS_CLIENT, useValue: mockRedis },
        { provide: 'AuthService', useValue: {} },
        // PieceRegistryService and its PIECES token are now mocked above
        { provide: PIECES, useValue: [] },
      ],
    })
      .overrideGuard(AuthGuard)
      .useValue({ canActivate: vi.fn().mockReturnValue(true) })
      .compile();

    oauthController = module.get<OAuthController>(OAuthController);
    credentialController =
      module.get<CredentialController>(CredentialController);
  });

  describe('createOAuthSession', () => {
    it('should create an OAuth session and return sessionId', async () => {
      mockPieceRegistry.resolveBasePieceName.mockReturnValue(
        'resolved-provider',
      );
      mockOAuthOrchestrationService.getProviderDefinition.mockReturnValue({
        auth: {
          type: 'OAUTH2',
          props: { domain: { type: 'SHORT_TEXT', required: true } },
        },
      } as unknown as Piece);
      mockOauthStateService.createPreFlightSession.mockResolvedValue(
        'mock-session-id',
      );

      const body = {
        providerName: 'mock-provider',
        clientId: 'client-123',
        vendorParams: { domain: 'test' },
      };

      const result = await oauthController.createOAuthSession(
        mockCtx,
        'mock-provider',
        body,
      );

      expect(result).toEqual({ sessionId: 'mock-session-id' });
      expect(mockPieceRegistry.resolveBasePieceName).toHaveBeenCalledWith(
        'mock-provider',
      );
      expect(mockOauthStateService.createPreFlightSession).toHaveBeenCalledWith(
        'tenant-123',
        'user-123',
        'resolved-provider',
        'client-123',
        { domain: 'test' },
        {},
      );
    });

    it('should throw BadRequestException if tenant or userId is missing', async () => {
      await expect(
        oauthController.createOAuthSession(missingTenantCtx, 'provider', {
          providerName: 'provider',
          clientId: '123',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if path param and body providerName do not match', async () => {
      await expect(
        oauthController.createOAuthSession(mockCtx, 'provider-a', {
          providerName: 'provider-b',
          clientId: '123',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should inject appProfile if provider is an alias', async () => {
      mockPieceRegistry.resolveBasePieceName.mockReturnValue(
        'resolved-provider',
      );
      mockPieceRegistry.getPiece.mockReturnValue({
        name: 'resolved-provider',
        aliases: [{ name: 'alias-provider', appProfile: 'custom-profile' }],
      } as unknown as Piece);
      mockOAuthOrchestrationService.getProviderDefinition.mockReturnValue({
        auth: { type: 'OAUTH2' },
      } as unknown as Piece);
      mockOauthStateService.createPreFlightSession.mockResolvedValue('session');

      const result = await oauthController.createOAuthSession(
        mockCtx,
        'alias-provider',
        {
          providerName: 'alias-provider',
          clientId: '123',
        },
      );

      expect(result).toEqual({ sessionId: 'session' });
      expect(mockOauthStateService.createPreFlightSession).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.any(String),
        expect.any(String),
        expect.any(Object),
        { appProfile: 'custom-profile' },
      );
    });

    it('should throw BadRequestException if provider definition is not found', async () => {
      mockOAuthOrchestrationService.getProviderDefinition.mockReturnValue(null);

      await expect(
        oauthController.createOAuthSession(mockCtx, 'provider', {
          providerName: 'provider',
          clientId: '123',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('initiateOAuth', () => {
    it('should create state, build auth URL and redirect', async () => {
      const mockRes = {
        redirect: vi.fn(),
        req: { params: { providerName: 'mock-piece' } },
      } as unknown as Response;

      mockOauthStateService.consumePreFlightSession.mockResolvedValue({
        tenantId: 'tenant-123',
        userId: 'user-123',
        provider: 'mock-piece',
        clientId: 'mock-client-id',
        vendorParams: {},
      });
      mockOauthStateService.generateState.mockResolvedValue('mocked_jwt_state');
      mockOAuthOrchestrationService.getAuthorizationUrl.mockReturnValue(
        'https://vendor.com/auth',
      );

      await oauthController.initiateOAuth(
        mockCtx,
        'mock-piece',
        'mock-session-id',
        mockRes,
      );

      expect(
        mockOauthStateService.consumePreFlightSession,
      ).toHaveBeenCalledWith('mock-session-id');
      expect(mockOauthStateService.generateState).toHaveBeenCalledWith(
        'tenant-123',
        'mock-piece',
        {},
        undefined,
      );
      expect(
        mockOAuthOrchestrationService.getAuthorizationUrl,
      ).toHaveBeenCalledWith(
        'mock-piece',
        'mocked_jwt_state',
        'mock-client-id',
        {},
      );
      expect(mockRes.redirect).toHaveBeenCalledWith('https://vendor.com/auth');
    });

    it('should throw BadRequestException if tenant is missing', async () => {
      const mockRes = {
        redirect: vi.fn(),
        req: { params: { providerName: 'mock-piece' } },
      } as unknown as Response;

      await expect(
        oauthController.initiateOAuth(
          missingTenantCtx,
          'mock-piece',
          'mock-session-id',
          mockRes,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if sessionId is missing', async () => {
      const mockRes = {
        redirect: vi.fn(),
        req: { params: { providerName: 'mock-piece' } },
      } as unknown as Response;

      await expect(
        oauthController.initiateOAuth(mockCtx, 'mock-piece', '', mockRes),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw UnauthorizedException if session context belongs to another tenant or user', async () => {
      const mockRes = {
        redirect: vi.fn(),
        req: { params: { providerName: 'mock-piece' } },
      } as unknown as Response;

      mockOauthStateService.consumePreFlightSession.mockResolvedValue({
        tenantId: 'tenant-123',
        userId: 'different-user',
        provider: 'mock-piece',
        clientId: 'mock-client-id',
        vendorParams: {},
      });

      await expect(
        oauthController.initiateOAuth(
          mockCtx,
          'mock-piece',
          'mock-session-id',
          mockRes,
        ),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException if consumePreFlightSession rejects', async () => {
      const mockRes = {
        redirect: vi.fn(),
        req: { params: { providerName: 'mock-piece' } },
      } as unknown as Response;

      mockOauthStateService.consumePreFlightSession.mockRejectedValue(
        new Error('rejected-session'),
      );

      await expect(
        oauthController.initiateOAuth(
          mockCtx,
          'mock-piece',
          'mock-session-id',
          mockRes,
        ),
      ).rejects.toThrow(UnauthorizedException);

      expect(mockOauthStateService.generateState).not.toHaveBeenCalled();
      expect(
        mockOAuthOrchestrationService.getAuthorizationUrl,
      ).not.toHaveBeenCalled();
    });

    it('should throw InternalServerErrorException if service fails', async () => {
      const mockRes = {
        redirect: vi.fn(),
        req: { params: { providerName: 'mock-piece' } },
      } as unknown as Response;

      mockOauthStateService.consumePreFlightSession.mockResolvedValue({
        tenantId: 'tenant-123',
        userId: 'user-123',
        provider: 'mock-piece',
        clientId: 'mock-client-id',
        vendorParams: {},
      });
      // Ensure validation passes so the error comes from getAuthorizationUrl.
      mockOAuthOrchestrationService.getProviderDefinition.mockReturnValue(null);
      mockOauthStateService.generateState.mockResolvedValue('state');
      mockOAuthOrchestrationService.getAuthorizationUrl.mockImplementation(
        () => {
          throw new Error('Config error');
        },
      );

      await expect(
        oauthController.initiateOAuth(
          mockCtx,
          'mock-piece',
          'mock-session-id',
          mockRes,
        ),
      ).rejects.toThrow(InternalServerErrorException);
    });
  });

  describe('getProviders', () => {
    it('should map aliases and merge their properties with the base piece', () => {
      mockPieceRegistry.getAllPieces.mockReturnValue([
        {
          name: 'base-piece',
          displayName: 'Base Piece',
          description: 'Base desc',
          logoUrl: 'base.png',
          auth: { type: 'OAUTH2', props: {} },
          aliases: [
            {
              name: 'alias-1',
              displayName: 'Alias 1',
              description: 'Alias desc',
              category: 'AliasCat',
            },
            {
              name: 'alias-2',
              displayName: 'Alias 2',
            },
          ],
        } as unknown as Piece,
      ]);

      const result = credentialController.getProviders();
      expect(result).toHaveLength(3);
      expect(result[0]).toMatchObject({
        name: 'base-piece',
        description: 'Base desc',
        category: 'Other',
        logoUrl: 'base.png',
      });
      expect(result[1]).toMatchObject({
        name: 'alias-1',
        description: 'Alias desc',
        category: 'AliasCat',
        logoUrl: 'base.png',
      });
      expect(result[2]).toMatchObject({
        name: 'alias-2',
        description: 'Base desc',
        logoUrl: 'base.png',
        category: 'Other',
      });
    });

    it('should map piece data exactly as required by the frontend uiSchema', () => {
      (mockPieceRegistry.getAllPieces as Mock).mockReturnValue([
        {
          name: 'mock-piece',
          displayName: 'MockPiece',
          description: 'CRM platform',
          logoUrl: 'https://logo.com/sf.png',
          categories: ['CRM'],
          auth: {
            type: 'OAUTH2',
            props: {},
          },
        },
      ]);

      const result = credentialController.getProviders();

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        name: 'mock-piece',
        displayName: 'MockPiece',
        description: 'CRM platform',
        logoUrl: 'https://logo.com/sf.png',
        authType: 'OAUTH2',
        category: 'CRM',
      });
      expect(result[0]).not.toHaveProperty('tokenUrl');
      expect(result[0]).not.toHaveProperty('authorizeUrl');
    });

    it('should bubble up InternalServerErrorException from the piece registry', () => {
      mockPieceRegistry.getAllPieces.mockImplementation(() => {
        throw new Error('Registry initialization error');
      });

      try {
        credentialController.getProviders();
        expect.unreachable('Should have thrown an exception');
      } catch (error) {
        expect(error).toBeInstanceOf(InternalServerErrorException);
        expect((error as Error).message).toContain('Failed to get providers');
      }
    });
  });

  describe('getActiveConnections', () => {
    it('should handle custom limit and offset parameters', async () => {
      const dataChain = {
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        offset: vi.fn().mockResolvedValue([]),
      };
      mockDb.where
        .mockReturnValueOnce(dataChain)
        .mockResolvedValueOnce([{ count: 0 }]);
      await credentialController.getActiveConnections(mockCtx, '10', '5');
      expect(dataChain.limit).toHaveBeenCalledWith(10);
      expect(dataChain.offset).toHaveBeenCalledWith(5);
    });

    it('should fallback to default limit and offset if parameters are invalid', async () => {
      const dataChain = {
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        offset: vi.fn().mockResolvedValue([]),
      };
      mockDb.where
        .mockReturnValueOnce(dataChain)
        .mockResolvedValueOnce([{ count: 0 }]);
      await credentialController.getActiveConnections(mockCtx, 'abc', '-5');
      expect(dataChain.limit).toHaveBeenCalledWith(50);
      expect(dataChain.offset).toHaveBeenCalledWith(0);
    });

    it('should throw InternalServerErrorException if DB fetch fails (Error object)', async () => {
      mockDb.where.mockRejectedValueOnce(new Error('Fetch failed'));
      await expect(
        credentialController.getActiveConnections(mockCtx),
      ).rejects.toThrow(InternalServerErrorException);
    });

    it('should throw InternalServerErrorException if DB fetch fails (Non-error object)', async () => {
      mockDb.where.mockRejectedValueOnce('Some string error');
      await expect(
        credentialController.getActiveConnections(mockCtx),
      ).rejects.toThrow(InternalServerErrorException);
    });

    it('should resolve alias appName if connection metadata contains appProfile', async () => {
      const mockConnectionRow = {
        id: '1',
        appName: 'base-piece',
        externalId: 'ext-1',
        displayName: 'Base',
        authType: 'OAUTH2' as const,
        status: AppConnectionStatus.ACTIVE,
        value: 'dummy',
        metadata: { appProfile: 'custom-profile' },
      };

      const dataChain = {
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        offset: vi.fn().mockResolvedValue([mockConnectionRow]),
      };

      mockDb.where
        .mockReturnValueOnce(dataChain)
        .mockResolvedValueOnce([{ count: 1 }]);

      mockPieceRegistry.getPiece.mockReturnValue({
        aliases: [{ name: 'alias-piece', appProfile: 'custom-profile' }],
      } as unknown as Piece);

      const result = await credentialController.getActiveConnections(mockCtx);
      expect(result.data[0].appName).toBe('alias-piece');
    });

    it('should return active connections with externalId and displayName for the requesting tenant', async () => {
      const mockDate = new Date();
      const mockConnectionRow = {
        id: '1',
        appName: 'mock-piece',
        externalId: 'mock-piece-tms',
        displayName: 'TMS MockPiece',
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

      const result = await credentialController.getActiveConnections(mockCtx);

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
        hasCredentials: true,
      };

      expect(result.data.length).toBe(1);
      expect(result.data[0].id).toBe('1');
      expect(result.metadata).toEqual({ limit: 50, offset: 0, count: 1 });

      // No credentials JOIN — value is encrypted and never returned to client
      expect(result.data[0]).not.toHaveProperty('value');
      expect(result.data[0]).not.toHaveProperty('encryptedCredentials');
      expect(result.data[0]).toHaveProperty('externalId', 'mock-piece-tms');
      expect(result.data[0]).toHaveProperty('displayName', 'TMS MockPiece');
    });

    it('should throw BadRequestException if tenantId is missing', async () => {
      await expect(
        credentialController.getActiveConnections(missingTenantCtx, '50', '0'),
      ).rejects.toThrow(new BadRequestException('tenantId context is missing'));
    });
  });

  describe('exchangeCode', () => {
    it('should resolve alias appProfile if providerName is an alias', async () => {
      mockRedis.set.mockResolvedValue('OK');
      mockOAuthOrchestrationService.exchangeCodeForTokens.mockResolvedValue({
        access_token: 'access',
        refresh_token: 'refresh',
        expires_in: 3600,
      });
      mockOauthStateService.verifyState.mockResolvedValue({
        tenantId: 'tenant-123',
        vendorParams: { realmId: 'test-123' },
      });
      mockEncryptionService.encrypt.mockResolvedValue('encrypted');
      mockCredentialLinkingService.storeOAuthConnection.mockResolvedValue(
        undefined,
      );

      mockPieceRegistry.resolveBasePieceName.mockReturnValueOnce('base-piece');
      mockPieceRegistry.getPiece.mockReturnValueOnce({
        aliases: [{ name: 'alias-provider', appProfile: 'custom-profile' }],
      } as unknown as Piece);

      await oauthController.exchangeCode(mockCtx, {
        providerName: 'alias-provider',
        code: 'auth-code',
        clientId: 'client',
        clientSecret: 'secret',
        state: 'valid-state',
        displayName: 'My Alias',
      });

      expect(
        mockCredentialLinkingService.storeOAuthConnection,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          providerName: 'base-piece',
          metadata: expect.objectContaining({ appProfile: 'custom-profile' }),
        }),
      );
    });

    it('should throw BadRequestException if displayName is blank', async () => {
      await expect(
        oauthController.exchangeCode(mockCtx, {
          providerName: 'provider',
          code: 'c',
          clientId: 'c',
          clientSecret: 's',
          state: 's',
          displayName: '   ',
        }),
      ).rejects.toThrow('displayName cannot be blank');
    });

    it('should throw BadRequestException if displayName exceeds max length', async () => {
      await expect(
        oauthController.exchangeCode(mockCtx, {
          providerName: 'provider',
          code: 'c',
          clientId: 'c',
          clientSecret: 's',
          state: 's',
          displayName: 'A'.repeat(300),
        }),
      ).rejects.toThrow(/displayName exceeds/);
    });

    const validBody = {
      providerName: 'mock-piece',
      code: 'auth-code-123',
      clientId: 'client-123',
      clientSecret: 'secret-123',
      state: 'valid-state',
      displayName: 'TMS MockPiece',
      env: 'sandbox',
      vendorParams: { realmId: 'test-123' },
    };

    const mockTokenResponse = {
      access_token: 'access-123',
      refresh_token: 'refresh-123',
      expires_in: 3600,
    };

    beforeEach(() => {
      mockPieceRegistry.getPiece.mockReturnValue({
        name: 'mock-piece',
        defaultAppProfile: 'standard',
        auth: {
          type: 'OAUTH2',
          props: { realmId: { type: 'SHORT_TEXT', required: false } },
        },
      } as unknown as Piece);
    });

    it('should successfully exchange the code and store a single connection row', async () => {
      // Simulate acquiring the idempotency lock
      mockRedis.set.mockResolvedValue('OK');
      mockOAuthOrchestrationService.exchangeCodeForTokens.mockResolvedValue(
        mockTokenResponse,
      );
      mockOauthStateService.verifyState.mockResolvedValue({
        tenantId: 'tenant-123',
        vendorParams: { realmId: 'test-123' },
      });
      mockEncryptionService.encrypt.mockResolvedValue('encrypted-value-blob');
      mockCredentialLinkingService.storeOAuthConnection.mockResolvedValue(
        undefined,
      );

      const result = await oauthController.exchangeCode(mockCtx, validBody);

      expect(result).toEqual({
        success: true,
        message: 'TMS MockPiece connected successfully.',
      });
      expect(
        mockOAuthOrchestrationService.exchangeCodeForTokens,
      ).toHaveBeenCalledWith(
        'mock-piece',
        'auth-code-123',
        'client-123',
        'secret-123',
        { realmId: 'test-123' },
      );
      expect(mockOauthStateService.verifyState).toHaveBeenCalledWith(
        'valid-state',
        'mock-piece',
      );
      expect(
        mockCredentialLinkingService.storeOAuthConnection,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: 'tenant-123',
          providerName: 'mock-piece',
          displayName: 'TMS MockPiece',
          authType: 'OAUTH2',
          value: expect.any(String),
          envType: 'PRODUCTION',
        }),
      );
    });

    it('should derive envType SANDBOX when vendorParams.environment is "test"', async () => {
      // Provider must declare `environment` so validateVendorParams accepts it
      mockPieceRegistry.getPiece.mockReturnValue({
        name: 'mock-piece',
        defaultAppProfile: 'standard',
        auth: {
          type: 'OAUTH2',
          props: {
            realmId: { type: 'SHORT_TEXT', required: false },
            environment: { type: 'SHORT_TEXT', required: false },
          },
        },
      } as unknown as Piece);
      mockRedis.set.mockResolvedValue('OK');
      mockOAuthOrchestrationService.exchangeCodeForTokens.mockResolvedValue(
        mockTokenResponse,
      );
      mockOauthStateService.verifyState.mockResolvedValue({
        tenantId: 'tenant-123',
        vendorParams: { environment: 'test', realmId: 'test-realm' },
      });
      mockEncryptionService.encrypt.mockResolvedValue('encrypted-value-blob');
      mockCredentialLinkingService.storeOAuthConnection.mockResolvedValue(
        undefined,
      );

      await oauthController.exchangeCode(mockCtx, validBody);

      expect(
        mockCredentialLinkingService.storeOAuthConnection,
      ).toHaveBeenCalledWith(expect.objectContaining({ envType: 'SANDBOX' }));
    });
    it('should resolve appProfile from state metadata during code exchange', async () => {
      mockRedis.set.mockResolvedValue('OK');
      mockOAuthOrchestrationService.exchangeCodeForTokens.mockResolvedValue(
        mockTokenResponse,
      );
      mockOauthStateService.verifyState.mockResolvedValue({
        tenantId: 'tenant-123',
        vendorParams: { realmId: 'test-123' },
        metadata: { appProfile: 'state-resolved-profile' },
      });
      mockEncryptionService.encrypt.mockResolvedValue('encrypted-value-blob');
      mockCredentialLinkingService.storeOAuthConnection.mockResolvedValue(
        undefined,
      );

      await oauthController.exchangeCode(mockCtx, validBody);

      expect(
        mockCredentialLinkingService.storeOAuthConnection,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            appProfile: 'state-resolved-profile',
          }),
        }),
      );
    });

    it('should throw UnauthorizedException if verifyState throws', async () => {
      mockOauthStateService.verifyState.mockImplementationOnce(() => {
        throw new Error('Invalid state signature');
      });

      await expect(
        oauthController.exchangeCode(mockCtx, validBody),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException if state token does not belong to this tenant', async () => {
      mockOauthStateService.verifyState.mockResolvedValueOnce({
        tenantId: 'other-tenant',
      });

      await expect(
        oauthController.exchangeCode(mockCtx, validBody),
      ).rejects.toThrow(
        new UnauthorizedException(
          'Invalid or expired OAuth state. Please start the connection process again.',
        ),
      );
    });
  });

  describe('getConnectionCredentials', () => {
    it('should throw BadRequestException if tenantId is missing', async () => {
      await expect(
        credentialController.getConnectionCredentials(
          missingTenantCtx,
          'uuid-123',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException if connection not found', async () => {
      mockDb.where.mockReturnValueOnce({
        limit: vi.fn().mockResolvedValueOnce([{ role: 'admin' }]),
      });
      mockDb.where.mockReturnValueOnce({
        limit: vi.fn().mockResolvedValueOnce([]),
      });
      await expect(
        credentialController.getConnectionCredentials(mockCtx, 'uuid-123'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should decrypt connection value if present', async () => {
      mockDb.where.mockReturnValueOnce({
        limit: vi.fn().mockResolvedValueOnce([{ role: 'admin' }]),
      });
      mockDb.where.mockReturnValueOnce({
        limit: vi
          .fn()
          .mockResolvedValueOnce([{ id: 'uuid-123', value: 'encrypted' }]),
      });
      // Mock decrypt
      mockEncryptionService.decrypt.mockResolvedValueOnce(
        JSON.stringify({
          clientId: 'client',
          clientSecret: 'secret',
          vendorParams: { a: '1' },
        }),
      );
      const res = await credentialController.getConnectionCredentials(
        mockCtx,
        'uuid-123',
      );
      expect(res).toEqual({
        clientId: 'client',
        hasClientSecret: true,
        vendorParams: { a: '1' },
      }); // secret stripped
    });

    it('should return defaults if connection value is missing', async () => {
      mockDb.where.mockReturnValueOnce({
        limit: vi.fn().mockResolvedValueOnce([{ role: 'admin' }]),
      });
      mockDb.where.mockReturnValueOnce({
        limit: vi.fn().mockResolvedValueOnce([{ id: 'uuid-123', value: null }]),
      });
      const res = await credentialController.getConnectionCredentials(
        mockCtx,
        'uuid-123',
      );
      expect(res).toEqual({
        clientId: '',
        hasClientSecret: false,
        vendorParams: undefined,
      });
    });

    it('should handle decryption errors and throw InternalServerErrorException (Error object)', async () => {
      mockDb.where.mockReturnValueOnce({
        limit: vi.fn().mockResolvedValueOnce([{ role: 'admin' }]),
      });
      mockDb.where.mockReturnValueOnce({
        limit: vi
          .fn()
          .mockResolvedValueOnce([{ id: 'uuid-123', value: 'encrypted' }]),
      });
      mockEncryptionService.decrypt.mockRejectedValueOnce(
        new Error('Decrypt failed'),
      );
      await expect(
        credentialController.getConnectionCredentials(mockCtx, 'uuid-123'),
      ).rejects.toThrow(InternalServerErrorException);
    });

    it('should handle decryption errors and throw InternalServerErrorException (String error)', async () => {
      mockDb.where.mockReturnValueOnce({
        limit: vi.fn().mockResolvedValueOnce([{ role: 'admin' }]),
      });
      mockDb.where.mockReturnValueOnce({
        limit: vi
          .fn()
          .mockResolvedValueOnce([{ id: 'uuid-123', value: 'encrypted' }]),
      });
      mockEncryptionService.decrypt.mockRejectedValueOnce('String error');
      await expect(
        credentialController.getConnectionCredentials(mockCtx, 'uuid-123'),
      ).rejects.toThrow(InternalServerErrorException);
    });
  });

  describe('deleteConnection', () => {
    it('should delete a connection if user is admin', async () => {
      mockDb.where.mockReturnValueOnce({
        limit: vi.fn().mockResolvedValueOnce([{ role: 'admin' }]),
      });
      mockCredentialLinkingService.deleteConnection.mockResolvedValueOnce(
        undefined,
      );

      await credentialController.deleteConnection(
        mockCtx,
        'mock-data-source-id',
      );

      expect(mockDb.select).toHaveBeenCalled();
      expect(
        mockCredentialLinkingService.deleteConnection,
      ).toHaveBeenCalledWith('tenant-123', 'mock-data-source-id');
    });

    it('should delete a connection if user is owner', async () => {
      mockDb.where.mockReturnValueOnce({
        limit: vi.fn().mockResolvedValueOnce([{ role: 'owner' }]),
      });
      mockCredentialLinkingService.deleteConnection.mockResolvedValueOnce(
        undefined,
      );

      await credentialController.deleteConnection(
        mockCtx,
        'mock-data-source-id',
      );

      expect(mockDb.select).toHaveBeenCalled();
      expect(
        mockCredentialLinkingService.deleteConnection,
      ).toHaveBeenCalledWith('tenant-123', 'mock-data-source-id');
    });

    it('should throw ForbiddenException if user is not admin or owner', async () => {
      mockDb.where.mockReturnValueOnce({
        limit: vi.fn().mockResolvedValueOnce([{ role: 'member' }]),
      });

      await expect(
        credentialController.deleteConnection(mockCtx, 'mock-data-source-id'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw BadRequestException if tenant is missing', async () => {
      await expect(
        credentialController.deleteConnection(
          missingTenantCtx,
          'mock-data-source-id',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should propagate HttpException from deleteConnection', async () => {
      mockDb.where.mockReturnValueOnce({
        limit: vi.fn().mockResolvedValueOnce([{ role: 'admin' }]),
      });
      mockCredentialLinkingService.deleteConnection.mockRejectedValueOnce(
        new NotFoundException('Connection not found'),
      );

      await expect(
        credentialController.deleteConnection(mockCtx, 'mock-data-source-id'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should wrap generic error in InternalServerErrorException', async () => {
      mockDb.where.mockReturnValueOnce({
        limit: vi.fn().mockResolvedValueOnce([{ role: 'admin' }]),
      });
      mockCredentialLinkingService.deleteConnection.mockRejectedValueOnce(
        new Error('Generic error'),
      );

      await expect(
        credentialController.deleteConnection(mockCtx, 'mock-data-source-id'),
      ).rejects.toThrow(InternalServerErrorException);
    });
  });
});
