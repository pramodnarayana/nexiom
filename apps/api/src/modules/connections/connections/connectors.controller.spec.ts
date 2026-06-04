import type { Piece } from '@soopa/piece-framework';
/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { ConnectorsController } from './connectors.controller.js';
import { EncryptionService } from '@soopa/credentials';
import { ConnectorsService } from '../connectors.service.js';
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

describe('ConnectorsController', () => {
  let controller: ConnectorsController;
  let mockPieceRegistry: Mocked<PieceRegistryService>;
  let mockConnectorsService: Mocked<ConnectorsService>;
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

    mockConnectorsService = {
      getAuthorizationUrl: vi.fn(),
      exchangeCodeForTokens: vi.fn(),
      storeOAuthConnection: vi.fn(),
      deleteConnection: vi.fn(),
      // Returns null so vendorParams validation is skipped (no schema to validate against).
      getProviderDefinition: vi.fn().mockReturnValue(null),
    } as unknown as Mocked<ConnectorsService>;

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
      controllers: [ConnectorsController],
      providers: [
        { provide: PieceRegistryService, useValue: mockPieceRegistry },
        { provide: ConnectorsService, useValue: mockConnectorsService },
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

    controller = module.get<ConnectorsController>(ConnectorsController);
  });

  describe('createOAuthSession', () => {
    it('should create an OAuth session and return sessionId', async () => {
      mockPieceRegistry.resolveBasePieceName.mockReturnValue(
        'resolved-provider',
      );
      mockConnectorsService.getProviderDefinition.mockReturnValue({
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

      const result = await controller.createOAuthSession(
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
        controller.createOAuthSession(missingTenantCtx, 'provider', {
          providerName: 'provider',
          clientId: '123',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if path param and body providerName do not match', async () => {
      await expect(
        controller.createOAuthSession(mockCtx, 'provider-a', {
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
      mockConnectorsService.getProviderDefinition.mockReturnValue({
        auth: { type: 'OAUTH2' },
      } as unknown as Piece);
      mockOauthStateService.createPreFlightSession.mockResolvedValue('session');

      const result = await controller.createOAuthSession(
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
      mockConnectorsService.getProviderDefinition.mockReturnValue(null);

      await expect(
        controller.createOAuthSession(mockCtx, 'provider', {
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
      mockConnectorsService.getAuthorizationUrl.mockReturnValue(
        'https://vendor.com/auth',
      );

      await controller.initiateOAuth(
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
      expect(mockConnectorsService.getAuthorizationUrl).toHaveBeenCalledWith(
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
        controller.initiateOAuth(
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
        controller.initiateOAuth(mockCtx, 'mock-piece', '', mockRes),
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
        controller.initiateOAuth(
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
        controller.initiateOAuth(
          mockCtx,
          'mock-piece',
          'mock-session-id',
          mockRes,
        ),
      ).rejects.toThrow(UnauthorizedException);

      expect(mockOauthStateService.generateState).not.toHaveBeenCalled();
      expect(mockConnectorsService.getAuthorizationUrl).not.toHaveBeenCalled();
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
      mockConnectorsService.getProviderDefinition.mockReturnValue(null);
      mockOauthStateService.generateState.mockResolvedValue('state');
      mockConnectorsService.getAuthorizationUrl.mockImplementation(() => {
        throw new Error('Config error');
      });

      await expect(
        controller.initiateOAuth(
          mockCtx,
          'mock-piece',
          'mock-session-id',
          mockRes,
        ),
      ).rejects.toThrow(InternalServerErrorException);
    });
  });

  describe('getProviders', () => {
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

      const result = controller.getProviders();

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
        hasCredentials: true,
      };

      expect(result).toEqual({
        data: [safeMockRow],
        metadata: { limit: 50, offset: 0, count: 1 },
      });

      // No credentials JOIN — value is encrypted and never returned to client
      expect(result.data[0]).not.toHaveProperty('value');
      expect(result.data[0]).not.toHaveProperty('encryptedCredentials');
      expect(result.data[0]).toHaveProperty('externalId', 'mock-piece-tms');
      expect(result.data[0]).toHaveProperty('displayName', 'TMS MockPiece');
    });

    it('should throw BadRequestException if tenantId is missing', async () => {
      await expect(
        controller.getActiveConnections(missingTenantCtx, '50', '0'),
      ).rejects.toThrow(new BadRequestException('tenantId context is missing'));
    });
  });

  describe('exchangeCode', () => {
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
      mockConnectorsService.exchangeCodeForTokens.mockResolvedValue(
        mockTokenResponse,
      );
      mockOauthStateService.verifyState.mockResolvedValue({
        tenantId: 'tenant-123',
        vendorParams: { realmId: 'test-123' },
      });
      mockEncryptionService.encrypt.mockResolvedValue('encrypted-value-blob');
      mockConnectorsService.storeOAuthConnection.mockResolvedValue(undefined);

      const result = await controller.exchangeCode(mockCtx, validBody);

      expect(result).toEqual({
        success: true,
        message: 'Connection established',
      });
      expect(mockConnectorsService.exchangeCodeForTokens).toHaveBeenCalledWith(
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
      // Single encrypt call — value blob contains clientId, clientSecret, tokens
      expect(mockEncryptionService.encrypt).toHaveBeenCalledTimes(1);
      expect(mockEncryptionService.encrypt).toHaveBeenCalledWith(
        expect.stringMatching(/test-123/), // vendorParams.realmId
      );
      expect(mockEncryptionService.encrypt).toHaveBeenCalledWith(
        expect.stringMatching(/access-123/), // tokenResponse.access_token
      );
      expect(mockConnectorsService.storeOAuthConnection).toHaveBeenCalledWith({
        id: undefined,
        tenantId: 'tenant-123',
        providerName: 'mock-piece',
        externalId: expect.stringMatching(
          /^mock-piece-tms-mockpiece-[a-f0-9]{4}$/,
        ) as unknown as string, // auto-generated kebab slug (namespaced + UUID)
        displayName: 'TMS MockPiece',
        authType: 'OAUTH2',
        value: 'encrypted-value-blob',
        expiresAt: expect.any(Date) as unknown as Date,
        metadata: { appProfile: 'standard' }, // controller always injects appProfile
        // No environment vendorParam in mock → deriveEnvType defaults to PRODUCTION
        envType: 'PRODUCTION',
      });
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
      mockConnectorsService.exchangeCodeForTokens.mockResolvedValue(
        mockTokenResponse,
      );
      mockOauthStateService.verifyState.mockResolvedValue({
        tenantId: 'tenant-123',
        vendorParams: { environment: 'test', realmId: 'test-realm' },
      });
      mockEncryptionService.encrypt.mockResolvedValue('encrypted-value-blob');
      mockConnectorsService.storeOAuthConnection.mockResolvedValue(undefined);

      await controller.exchangeCode(mockCtx, validBody);

      expect(mockConnectorsService.storeOAuthConnection).toHaveBeenCalledWith(
        expect.objectContaining({ envType: 'SANDBOX' }),
      );
    });
    it('should resolve appProfile from state metadata during code exchange', async () => {
      mockRedis.set.mockResolvedValue('OK');
      mockConnectorsService.exchangeCodeForTokens.mockResolvedValue(
        mockTokenResponse,
      );
      mockOauthStateService.verifyState.mockResolvedValue({
        tenantId: 'tenant-123',
        vendorParams: { realmId: 'test-123' },
        metadata: { appProfile: 'state-resolved-profile' },
      });
      mockEncryptionService.encrypt.mockResolvedValue('encrypted-value-blob');
      mockConnectorsService.storeOAuthConnection.mockResolvedValue(undefined);

      await controller.exchangeCode(mockCtx, validBody);

      expect(mockConnectorsService.storeOAuthConnection).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: { appProfile: 'state-resolved-profile' },
        }),
      );
    });
    it('should preserve existing externalId during a reconnect flow (dataSourceId provided)', async () => {
      // Mock the essential services that processOAuthExchange relies on
      mockRedis.set.mockResolvedValue('OK');
      mockConnectorsService.exchangeCodeForTokens.mockResolvedValue(
        mockTokenResponse,
      );
      mockOauthStateService.verifyState.mockResolvedValue({
        tenantId: 'tenant-123',
        vendorParams: { realmId: 'test-123' },
      });
      mockEncryptionService.encrypt.mockResolvedValue('encrypted-value-blob');
      mockConnectorsService.storeOAuthConnection.mockResolvedValue(undefined);

      // Mock the database returning an existing connection with a specific externalId
      mockDb.where.mockResolvedValueOnce([{ externalId: 'existing-slug-123' }]);

      const reconnectBody = {
        ...validBody,
        dataSourceId: 'existing-connection-id',
      };

      const result = await controller.exchangeCode(mockCtx, reconnectBody);

      expect(result).toEqual({
        success: true,
        message: 'Connection established',
      });
      // Ensure the DB was queried to fetch the old externalId
      expect(mockDb.select).toHaveBeenCalled();
      expect(mockDb.from).toHaveBeenCalled();
      expect(mockDb.where).toHaveBeenCalled();

      // Ensure that the original externalId from the DB was preserved instead of randomly generated
      expect(mockConnectorsService.storeOAuthConnection).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'existing-connection-id', // ensure it passes the id along
          externalId: 'existing-slug-123', // Expect the mocked existing slug
        }),
      );
    });
    it('should throw NotFoundException if reconnect dataSourceId is not found in DB', async () => {
      mockOauthStateService.verifyState.mockResolvedValue({
        tenantId: 'tenant-123',
        vendorParams: { realmId: 'test-123' },
      });

      // Mock DB returning nothing for the reconnect lookup
      mockDb.where.mockResolvedValueOnce([]);

      const reconnectBody = {
        ...validBody,
        dataSourceId: 'missing-id',
      };

      await expect(
        controller.exchangeCode(mockCtx, reconnectBody),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException on DB errors during reconnect lookups', async () => {
      mockRedis.set.mockResolvedValue('OK');
      mockConnectorsService.exchangeCodeForTokens.mockResolvedValue(
        mockTokenResponse,
      );
      mockOauthStateService.verifyState.mockResolvedValue({
        tenantId: 'tenant-123',
        vendorParams: { realmId: 'test-123' },
      });
      mockEncryptionService.encrypt.mockResolvedValue('encrypted-value-blob');
      mockConnectorsService.storeOAuthConnection.mockResolvedValue(undefined);

      // Mock DB throwing an error
      mockDb.where.mockRejectedValueOnce(new Error('DB Timeout'));

      const reconnectBody = {
        ...validBody,
        dataSourceId: 'error-id',
      };

      await expect(
        controller.exchangeCode(mockCtx, reconnectBody),
      ).rejects.toThrow(BadRequestException);
    });

    // ── resolveCredentialsForExchange (indirect via exchangeCode) ──
    it('should resolve credentials from DB if clientSecret is missing and dataSourceId provided', async () => {
      mockOauthStateService.verifyState.mockResolvedValue({
        tenantId: 'tenant-123',
      });
      mockConnectorsService.exchangeCodeForTokens.mockResolvedValue(
        mockTokenResponse,
      );
      mockEncryptionService.encrypt.mockResolvedValue('encrypted');
      mockRedis.set.mockResolvedValue('OK');

      mockDb.where.mockResolvedValueOnce([{ externalId: 'existing-slug-123' }]);
      mockDb.where.mockReturnValueOnce({
        limit: vi.fn().mockResolvedValue([{ value: 'stored-encrypted-blob' }]),
      });

      mockEncryptionService.decrypt.mockResolvedValue(
        JSON.stringify({
          clientId: 'stored-client',
          clientSecret: 'stored-secret',
        }),
      );

      const reconnectBodyNoSecret = {
        ...validBody,
        clientSecret: undefined,
        dataSourceId: 'existing-id',
      };

      await controller.exchangeCode(mockCtx, reconnectBodyNoSecret);

      expect(mockConnectorsService.exchangeCodeForTokens).toHaveBeenCalledWith(
        'mock-piece',
        'auth-code-123',
        validBody.clientId, // Request client ID is used since it's provided
        'stored-secret',
        {},
      );
    });

    it('should fallback to stored credentials when both clientId and clientSecret are missing', async () => {
      mockOauthStateService.verifyState.mockResolvedValue({
        tenantId: 'tenant-123',
      });
      mockConnectorsService.exchangeCodeForTokens.mockResolvedValue(
        mockTokenResponse,
      );
      mockEncryptionService.encrypt.mockResolvedValue('encrypted');
      mockRedis.set.mockResolvedValue('OK');

      mockDb.where.mockResolvedValueOnce([{ externalId: 'existing-slug-456' }]);
      mockDb.where.mockReturnValueOnce({
        limit: vi.fn().mockResolvedValue([{ value: 'stored-encrypted-blob' }]),
      });

      mockEncryptionService.decrypt.mockResolvedValue(
        JSON.stringify({
          clientId: 'stored-client-id',
          clientSecret: 'stored-client-secret',
        }),
      );

      const reconnectBodyNoCreds = {
        ...validBody,
        clientId: undefined,
        clientSecret: undefined,
        dataSourceId: 'existing-id',
      };

      await controller.exchangeCode(mockCtx, reconnectBodyNoCreds);

      expect(mockConnectorsService.exchangeCodeForTokens).toHaveBeenCalledWith(
        'mock-piece',
        'auth-code-123',
        'stored-client-id',
        'stored-client-secret',
        {},
      );
    });

    it('should throw NotFoundException if stored credentials not found in DB', async () => {
      mockOauthStateService.verifyState.mockResolvedValue({
        tenantId: 'tenant-123',
      });
      mockRedis.set.mockResolvedValue('OK');

      mockDb.where.mockResolvedValueOnce([{ externalId: 'existing-slug-123' }]);
      mockDb.where.mockReturnValueOnce({
        limit: vi.fn().mockResolvedValue([]),
      });

      const reconnectBodyNoSecret = {
        ...validBody,
        clientSecret: undefined,
        dataSourceId: 'existing-id',
      };
      await expect(
        controller.exchangeCode(mockCtx, reconnectBodyNoSecret),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw InternalServerErrorException if DB fetch fails in resolveCredentials', async () => {
      mockOauthStateService.verifyState.mockResolvedValue({
        tenantId: 'tenant-123',
      });
      mockRedis.set.mockResolvedValue('OK');

      mockDb.where.mockResolvedValueOnce([{ externalId: 'existing-slug-123' }]);
      mockDb.where.mockReturnValueOnce({
        limit: vi.fn().mockRejectedValue(new Error('DB Error')),
      });

      const reconnectBodyNoSecret = {
        ...validBody,
        clientSecret: undefined,
        dataSourceId: 'existing-id',
      };
      await expect(
        controller.exchangeCode(mockCtx, reconnectBodyNoSecret),
      ).rejects.toThrow(InternalServerErrorException);
    });

    it('should throw InternalServerErrorException if decrypt fails in resolveCredentials', async () => {
      mockOauthStateService.verifyState.mockResolvedValue({
        tenantId: 'tenant-123',
      });
      mockRedis.set.mockResolvedValue('OK');

      mockDb.where.mockResolvedValueOnce([{ externalId: 'existing-slug-123' }]);
      mockDb.where.mockReturnValueOnce({
        limit: vi.fn().mockResolvedValue([{ value: 'stored' }]),
      });
      mockEncryptionService.decrypt.mockRejectedValue(
        new Error('Decrypt error'),
      );

      const reconnectBodyNoSecret = {
        ...validBody,
        clientSecret: undefined,
        dataSourceId: 'existing-id',
      };
      await expect(
        controller.exchangeCode(mockCtx, reconnectBodyNoSecret),
      ).rejects.toThrow(InternalServerErrorException);
    });

    it('should throw BadRequestException if stored credential has no secret', async () => {
      mockOauthStateService.verifyState.mockResolvedValue({
        tenantId: 'tenant-123',
      });
      mockRedis.set.mockResolvedValue('OK');

      mockDb.where.mockResolvedValueOnce([{ externalId: 'existing-slug-123' }]);
      mockDb.where.mockReturnValueOnce({
        limit: vi.fn().mockResolvedValue([{ value: 'stored' }]),
      });
      mockEncryptionService.decrypt.mockResolvedValue(
        JSON.stringify({ clientId: 'id' }),
      ); // no secret

      const reconnectBodyNoSecret = {
        ...validBody,
        clientSecret: undefined,
        dataSourceId: 'existing-id',
      };
      await expect(
        controller.exchangeCode(mockCtx, reconnectBodyNoSecret),
      ).rejects.toThrow(BadRequestException);
    });

    // Note: DTO validation (ValidationPipe) tests are typically handled in e2e tests

    it('should throw NotFoundException if provider is not registered', async () => {
      mockPieceRegistry.getPiece.mockReturnValue(undefined);
      await expect(controller.exchangeCode(mockCtx, validBody)).rejects.toThrow(
        new NotFoundException('Provider "mock-piece" is not registered'),
      );
    });

    it('should throw BadRequestException if verifyState throws', async () => {
      mockOauthStateService.verifyState.mockImplementationOnce(() => {
        throw new BadRequestException('Invalid state signature');
      });

      await expect(controller.exchangeCode(mockCtx, validBody)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException if state token does not belong to this tenant', async () => {
      mockOauthStateService.verifyState.mockResolvedValueOnce({
        tenantId: 'other-tenant',
      });

      await expect(controller.exchangeCode(mockCtx, validBody)).rejects.toThrow(
        new BadRequestException('State token does not belong to this tenant'),
      );
    });

    it('should throw InternalServerErrorException if exchangeCodeForTokens throws', async () => {
      mockConnectorsService.exchangeCodeForTokens.mockRejectedValue(
        new Error('Network error'),
      );
      await expect(controller.exchangeCode(mockCtx, validBody)).rejects.toThrow(
        new InternalServerErrorException('Failed to exchange auth code'),
      );
    });

    it('should throw InternalServerErrorException if encrypt throws', async () => {
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

    it('should return immediately if the idempotency lock cannot be acquired (already completed)', async () => {
      // Simulate another request having already acquired the lock (NX returns null/undefined)
      mockRedis.set.mockResolvedValue(null);
      mockRedis.get.mockResolvedValue('completed');

      const result = await controller.exchangeCode(mockCtx, validBody);

      // Verify it returns the idempotent success message
      expect(result).toEqual({
        success: true,
        message: 'Connection established (Idempotent)',
      });

      // Verify no downstream services were called
      expect(mockOauthStateService.verifyState).not.toHaveBeenCalled();
      expect(
        mockConnectorsService.exchangeCodeForTokens,
      ).not.toHaveBeenCalled();
      expect(mockEncryptionService.encrypt).not.toHaveBeenCalled();
      expect(mockConnectorsService.storeOAuthConnection).not.toHaveBeenCalled();
    });

    it('should throw 409 Conflict if the idempotency lock cannot be acquired (currently processing)', async () => {
      mockRedis.set.mockResolvedValue(null);
      mockRedis.get.mockResolvedValue('processing');

      await expect(controller.exchangeCode(mockCtx, validBody)).rejects.toThrow(
        new HttpException('OAuth exchange already in progress', 409),
      );
    });

    it('should remove the idempotency marker if a downstream service throws an error', async () => {
      mockRedis.set.mockResolvedValue('OK');
      mockOauthStateService.verifyState.mockResolvedValue({
        tenantId: 'tenant-123',
        vendorParams: { realmId: 'test-123' },
      });
      mockConnectorsService.exchangeCodeForTokens.mockRejectedValue(
        new Error('Unexpected external API failure'),
      );

      await expect(controller.exchangeCode(mockCtx, validBody)).rejects.toThrow(
        InternalServerErrorException,
      );

      expect(mockRedis.del).toHaveBeenCalledWith(
        `oauth:idempotency:tenant-123:create:${validBody.code}`,
      );
    });
  });

  describe('deleteConnection', () => {
    it('should delete a connection if user is admin', async () => {
      mockDb.where.mockReturnValueOnce({
        limit: vi.fn().mockResolvedValueOnce([{ role: 'admin' }]),
      });
      mockConnectorsService.deleteConnection.mockResolvedValueOnce(undefined);

      await controller.deleteConnection(mockCtx, 'mock-data-source-id');

      expect(mockDb.select).toHaveBeenCalled();
      expect(mockConnectorsService.deleteConnection).toHaveBeenCalledWith(
        'tenant-123',
        'mock-data-source-id',
      );
    });

    it('should delete a connection if user is owner', async () => {
      mockDb.where.mockReturnValueOnce({
        limit: vi.fn().mockResolvedValueOnce([{ role: 'owner' }]),
      });
      mockConnectorsService.deleteConnection.mockResolvedValueOnce(undefined);

      await controller.deleteConnection(mockCtx, 'mock-data-source-id');

      expect(mockDb.select).toHaveBeenCalled();
      expect(mockConnectorsService.deleteConnection).toHaveBeenCalledWith(
        'tenant-123',
        'mock-data-source-id',
      );
    });

    it('should throw ForbiddenException if user is not admin or owner', async () => {
      mockDb.where.mockReturnValueOnce({
        limit: vi.fn().mockResolvedValueOnce([{ role: 'member' }]),
      });

      await expect(
        controller.deleteConnection(mockCtx, 'mock-data-source-id'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw BadRequestException if tenant is missing', async () => {
      await expect(
        controller.deleteConnection(missingTenantCtx, 'mock-data-source-id'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should propagate HttpException from deleteConnection', async () => {
      mockDb.where.mockReturnValueOnce({
        limit: vi.fn().mockResolvedValueOnce([{ role: 'admin' }]),
      });
      mockConnectorsService.deleteConnection.mockRejectedValueOnce(
        new NotFoundException('Connection not found'),
      );

      await expect(
        controller.deleteConnection(mockCtx, 'mock-data-source-id'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should wrap generic error in InternalServerErrorException', async () => {
      mockDb.where.mockReturnValueOnce({
        limit: vi.fn().mockResolvedValueOnce([{ role: 'admin' }]),
      });
      mockConnectorsService.deleteConnection.mockRejectedValueOnce(
        new Error('Generic error'),
      );

      await expect(
        controller.deleteConnection(mockCtx, 'mock-data-source-id'),
      ).rejects.toThrow(InternalServerErrorException);
    });
  });
});
