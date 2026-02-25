/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { ConnectorsController } from './connectors.controller.js';
import {
  ProviderRegistryService,
  EncryptionService,
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

      controller.connect('salesforce', 'tenant-123', 'mock-client-id', mockRes);

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
        controller.connect('salesforce', '', 'mock-client-id', mockRes),
      ).toThrow(BadRequestException);
    });

    it('should throw BadRequestException if clientId is missing', () => {
      const mockRes = { redirect: vi.fn() } as unknown as Response;

      expect(() =>
        controller.connect('salesforce', 'tenant-123', '', mockRes),
      ).toThrow(BadRequestException);
    });

    it('should bubble up InternalServerErrorException if service fails', () => {
      const mockRes = { redirect: vi.fn() } as unknown as Response;

      mockOauthStateService.generateState.mockReturnValue('state');
      mockConnectorsService.getAuthorizationUrl.mockImplementation(() => {
        throw new Error('Config error');
      });

      expect(() =>
        controller.connect(
          'salesforce',
          'tenant-123',
          'mock-client-id',
          mockRes,
        ),
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
        encryptedCredentials: 'secret_leak',
        createdAt: mockDate,
        updatedAt: mockDate,
      };

      const { encryptedCredentials: _encryptedCredentials, ...expectedData } =
        mockConnectionInfo;

      // The controller calls where() twice: once for data, once for count.
      const dataChain = {
        limit: vi.fn().mockReturnThis(),
        offset: vi.fn().mockResolvedValue([expectedData]),
      };

      const countPromise = Promise.resolve([{ count: 1 }]);

      // First call gets dataChain, second call gets countPromise
      mockDb.where
        .mockReturnValueOnce(dataChain)
        .mockReturnValueOnce(countPromise);

      const result = await controller.getActiveConnections('tenant-123');

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

      expect(mockDb.select).not.toHaveBeenCalledWith(
        expect.objectContaining({
          encryptedCredentials: expect.anything() as unknown,
        }),
      );
    });

    it('should throw an error if tenantId is missing from the request', async () => {
      const promise = controller.getActiveConnections('', '50', '0');

      await expect(promise).rejects.toThrow(BadRequestException);
      await expect(promise).rejects.toThrow(
        'tenantId query parameter is required',
      );
    });
  });
});
