import { Test, TestingModule } from '@nestjs/testing';
import { ConnectorsController } from './connectors.controller';
import { ProviderRegistryService } from '@nexiom/engine';
import { appConnections, AppConnectionStatus } from '@nexiom/database';
import { eq, and } from 'drizzle-orm';
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

    mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn(),
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
        createdAt: mockDate,
        updatedAt: mockDate,
      };

      mockDb.where.mockResolvedValue([mockConnectionInfo]);

      const result = await controller.getActiveConnections(mockReq);

      expect(mockDb.select).toHaveBeenCalled();
      expect(mockDb.from).toHaveBeenCalled();

      const whereArg = mockDb.where.mock.calls[0][0] as unknown;
      expect(whereArg).toEqual(
        and(
          eq(appConnections.tenantId, 'tenant-123'),
          eq(appConnections.status, AppConnectionStatus.ACTIVE),
        ),
      );

      expect(result).toEqual([mockConnectionInfo]);
    });

    it('should throw an error if tenantId is missing from the request', async () => {
      const mockReq = { user: {} } as unknown as Request;
      await expect(controller.getActiveConnections(mockReq)).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(controller.getActiveConnections(mockReq)).rejects.toThrow(
        'Tenant ID missing from request',
      );
    });
  });
});
