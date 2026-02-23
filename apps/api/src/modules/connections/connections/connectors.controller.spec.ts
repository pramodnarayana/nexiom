/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { ConnectorsController } from './connectors.controller.js';
import { ProviderRegistryService } from '@nexiom/connections';
import { ConnectorsService } from '../connectors.service';
import { OauthStateService } from '../oauth-state.service';
import { AppConnectionStatus } from '@nexiom/database';
import {
  UnauthorizedException,
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
import type { Request, Response } from 'express';

describe('ConnectorsController', () => {
  let controller: ConnectorsController;
  let mockProviderRegistry: Mocked<ProviderRegistryService>;
  let mockConnectorsService: Mocked<ConnectorsService>;
  let mockOauthStateService: Mocked<OauthStateService>;
  let mockDb: {
    select: Mock;
    from: Mock;
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

    // Create two separate chain variables to easily assert against
    const dataChain = {
      limit: vi.fn().mockReturnThis(),
      offset: vi.fn().mockResolvedValue([]),
    };

    // Default the `where` mock to return the data chain
    mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnValue(dataChain),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ConnectorsController],
      providers: [
        { provide: ProviderRegistryService, useValue: mockProviderRegistry },
        { provide: ConnectorsService, useValue: mockConnectorsService },
        { provide: OauthStateService, useValue: mockOauthStateService },
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
    it('should generate state, get auth url and redirect', async () => {
      const mockReq = {
        user: { tenantId: 'tenant-123' },
      } as unknown as Request;
      const mockRes = { redirect: vi.fn() } as unknown as Response;

      mockOauthStateService.generateState.mockReturnValue('mocked_jwt_state');
      mockConnectorsService.getAuthorizationUrl.mockResolvedValue(
        'https://vendor.com/auth',
      );

      await controller.connect('salesforce', mockReq, mockRes);

      expect(mockOauthStateService.generateState).toHaveBeenCalledWith(
        'tenant-123',
        'salesforce',
        undefined,
      );
      expect(mockConnectorsService.getAuthorizationUrl).toHaveBeenCalledWith(
        'salesforce',
        'mocked_jwt_state',
        'tenant-123',
      );
      expect(mockRes.redirect).toHaveBeenCalledWith('https://vendor.com/auth');
    });

    it('should throw UnauthorizedException if tenant is missing', async () => {
      const mockReq = { user: {} } as unknown as Request;
      const mockRes = { redirect: vi.fn() } as unknown as Response;

      await expect(
        controller.connect('salesforce', mockReq, mockRes),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should bubble up InternalServerErrorException if service fails', async () => {
      const mockReq = {
        user: { tenantId: 'tenant-123' },
      } as unknown as Request;
      const mockRes = { redirect: vi.fn() } as unknown as Response;

      mockOauthStateService.generateState.mockReturnValue('state');
      mockConnectorsService.getAuthorizationUrl.mockRejectedValue(
        new Error('Config error'),
      );

      await expect(
        controller.connect('salesforce', mockReq, mockRes),
      ).rejects.toThrow(InternalServerErrorException);
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
          createdAt: new Date(),
          updatedAt: new Date(),
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
      const mockReq = {
        user: { tenantId: 'tenant-123' },
      } as unknown as Request;
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

      const result = await controller.getActiveConnections(mockReq);

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
      const mockReq = { user: {} } as unknown as Request;
      const promise = controller.getActiveConnections(mockReq, '50', '0');

      await expect(promise).rejects.toThrow(UnauthorizedException);
      await expect(promise).rejects.toThrow('Tenant ID missing from request');
    });
  });
});
