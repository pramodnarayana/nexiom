import type { Piece } from '@nexiom/connectors/framework';
/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { ConnectorsController } from './connectors.controller.js';
import { EncryptionService } from '@nexiom/connectors';
import { ConnectorsService } from '../connectors.service.js';
import { OauthStateService } from '../oauth-state.service.js';
import { AppConnectionStatus, DATABASE_CONNECTION } from '@nexiom/database';
import {
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import {
  PieceRegistryService,
  PIECES,
} from '../../trigger/piece-registry.service.js';
import {
  describe,
  it,
  expect,
  beforeEach,
  vi,
  type Mocked,
  type Mock,
} from 'vitest';
import { AuthGuard, type RequestAuthContext } from '@nexiom/auth';
import type { Response } from 'express';

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
  let mockPieceRegistry: Mocked<PieceRegistryService>;
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
    mockPieceRegistry = {
      getAllPieces: vi.fn(),
      getPiece: vi.fn(),
    } as unknown as Mocked<PieceRegistryService>;

    mockConnectorsService = {
      getAuthorizationUrl: vi.fn(),
      exchangeCodeForTokens: vi.fn(),
      storeOAuthConnection: vi.fn(),
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
        { provide: PieceRegistryService, useValue: mockPieceRegistry },
        { provide: ConnectorsService, useValue: mockConnectorsService },
        { provide: OauthStateService, useValue: mockOauthStateService },
        { provide: EncryptionService, useValue: mockEncryptionService },
        { provide: DATABASE_CONNECTION, useValue: mockDb },
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

  describe('initiateOAuth', () => {
    it('should create state, build auth URL and redirect', async () => {
      const mockRes = {
        redirect: vi.fn(),
        req: { params: { providerName: 'mock-piece' } },
      } as unknown as Response;

      mockOauthStateService.consumePreFlightSession.mockResolvedValue({
        tenantId: 'tenant-123',
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

    it('should throw InternalServerErrorException if service fails', async () => {
      const mockRes = {
        redirect: vi.fn(),
        req: { params: { providerName: 'mock-piece' } },
      } as unknown as Response;

      mockOauthStateService.consumePreFlightSession.mockResolvedValue({
        tenantId: 'tenant-123',
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
        auth: {
          type: 'OAUTH2',
          props: { realmId: { type: 'SHORT_TEXT', required: false } },
        },
      } as unknown as Piece);
    });

    it('should successfully exchange the code and store a single connection row', async () => {
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

      expect(result).toEqual({ success: true });
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
        tenantId: 'tenant-123',
        providerName: 'mock-piece',
        externalId: 'mock-piece-tms-mockpiece', // auto-generated kebab slug (namespaced)
        displayName: 'TMS MockPiece',
        authType: 'OAUTH2',
        value: 'encrypted-value-blob',
        expiresAt: expect.any(Date) as unknown as Date,
        metadata: {},
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
      mockPieceRegistry.getPiece.mockReturnValue(undefined);
      await expect(controller.exchangeCode(mockCtx, validBody)).rejects.toThrow(
        new BadRequestException('Provider "mock-piece" is not registered'),
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
  });
});
