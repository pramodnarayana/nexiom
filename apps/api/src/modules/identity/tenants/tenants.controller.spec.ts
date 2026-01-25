import { Test, TestingModule } from '@nestjs/testing';
import { Request } from 'express';
import { TenantsController } from './tenants.controller';
import { TENANT_PROVIDER, Tenant } from '@nexiom/identity';
import { AuthGuard } from '../auth/auth.guard';
import { UpdateTenantStatus } from './tenants.validation';

describe('TenantsController', () => {
  let controller: TenantsController;

  const mockTenantProvider = {
    findAllForUser: jest.fn(),
    updateStatus: jest.fn(),
  };

  const mockAuthGuard = {
    canActivate: jest.fn().mockImplementation(() => true),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TenantsController],
      providers: [
        {
          provide: TENANT_PROVIDER,
          useValue: mockTenantProvider,
        },
      ],
    })
      .overrideGuard(AuthGuard)
      .useValue(mockAuthGuard)
      .compile();

    controller = module.get<TenantsController>(TenantsController);

    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('findAll', () => {
    it('should return an array of organizations for the user', async () => {
      const result: Tenant[] = [
        {
          id: '1',
          name: 'Test Org',
          slug: 'test-org',
          logo: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          metadata: undefined,
          status: 'active',
        },
      ];
      mockTenantProvider.findAllForUser.mockResolvedValue(result);

      const req = { user: { id: 'user-1' } } as unknown as Request & {
        user: { id: string };
      };
      expect(await controller.findAll(req)).toBe(result);
      expect(mockTenantProvider.findAllForUser).toHaveBeenCalledWith('user-1');
    });
  });

  describe('updateStatus', () => {
    it('should update status', async () => {
      const id = '1';
      const status: UpdateTenantStatus = { status: 'disabled' };
      const result = { id, status: status.status };
      mockTenantProvider.updateStatus.mockResolvedValue(result);

      expect(await controller.updateStatus(id, status)).toBe(result);
      expect(mockTenantProvider.updateStatus).toHaveBeenCalledWith(
        id,
        status.status,
      );
    });
  });
});
