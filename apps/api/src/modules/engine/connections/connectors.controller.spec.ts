import { Test, TestingModule } from '@nestjs/testing';
import { ConnectorsController } from './connectors.controller';
import { ProviderRegistryService } from '@nexiom/engine';
import { AppConnectionStatus } from '@nexiom/database';
import { UnauthorizedException } from '@nestjs/common';
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
import type { Request } from 'express';

describe('ConnectorsController', () => {
  let controller: ConnectorsController;
  let mockProviderRegistry: Mocked<Partial<ProviderRegistryService>>;
  let mockDb: {
    select: Mock;
    from: Mock;
    where: Mock;
  };

  beforeEach(async () => {
    mockProviderRegistry = {
      getAllProviders: vi.fn(),
    };

    // Create two separate chain variables to easily assert against
    const dataChain = {
      limit: vi.fn().mockReturnThis(),
      offset: vi.fn(),
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

  describe('getProviders', () => {
    it('should map provider data exactly as required by the frontend uiSchema', async () => {
      // Arrange
      (mockProviderRegistry.getAllProviders as Mock).mockResolvedValue([
        {
          name: 'salesforce',
          displayName: 'Salesforce',
          authType: 'OAUTH2',
          description: 'CRM platform',
          logoUrl: 'https://logo.com/sf.png',
          category: 'CRM',
          enabled: true,
          scopes: [],
          uiSchema: {},
          authorizeUrl: '',
          tokenUrl: '',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      // Act
      const result = await controller.getProviders();

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
    });

    it('should bubble up errors from the provider registry', async () => {
      (mockProviderRegistry.getAllProviders as Mock).mockRejectedValue(
        new Error('DB connection failed'),
      );
      await expect(controller.getProviders()).rejects.toThrow(
        'DB connection failed',
      );
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

      const result = await controller.getActiveConnections(mockReq);

      expect(mockDb.select).toHaveBeenCalled();
      expect(mockDb.from).toHaveBeenCalled();

      expect(dataChain.limit).toHaveBeenCalledWith(50);
      expect(dataChain.offset).toHaveBeenCalledWith(0);

      expect(mockDb.where).toHaveBeenCalledTimes(2);

      expect(result).toEqual({
        data: [mockConnectionInfo],
        metadata: { limit: 50, offset: 0, count: 1 },
      });
      // Verify explicitly that encryptedCredentials is not passed through if omitted from projection, or test that the controller stripped it if it received it.
      // Wait, the test uses mockConnectionInfo which has encryptedCredentials. Since the DB returns it in the mock, the controller just returns activeConnections array directly.
      // If the controller returns it directly, the test should assert we don't return encryptedCredentials, or that the mockDb.select was explicitly called without it and the result reflects that.
      // Let's assert on the mockDb.select argument to ensure it doesn't include encryptedCredentials.
      expect(mockDb.select).toHaveBeenCalledWith(
        expect.not.objectContaining({
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
