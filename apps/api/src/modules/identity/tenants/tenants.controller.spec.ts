import { Test, TestingModule } from '@nestjs/testing';
import { Request } from 'express';
import { TenantsController } from './tenants.controller';
import { TENANT_PROVIDER, Tenant } from '@nexiom/identity';
import { AuthGuard } from '../auth/auth.guard';
import { UpdateTenantStatus } from './tenants.validation';

describe('TenantsController', () => {
  let controller: TenantsController;

  const mockTenantProvider = {
    findAllForUser: vi.fn(),
    updateStatus: vi.fn(),
    findOneForUser: vi.fn(),
    update: vi.fn(),
  };

  const mockAuthGuard = {
    canActivate: vi.fn().mockImplementation(() => true),
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

    vi.clearAllMocks();
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

  describe('findOne', () => {
    it('should return a tenant for the user', async () => {
      const tenant = {
        id: '1',
        name: 'Test Org',
        slug: 'test-org',
        logo: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        metadata: undefined,
        status: 'active' as const,
      };
      mockTenantProvider.findOneForUser.mockResolvedValue(tenant);

      const req = { user: { id: 'user-1' } } as unknown as Request & {
        user: { id: string };
      };
      expect(await controller.findOne('1', req)).toBe(tenant);
      expect(mockTenantProvider.findOneForUser).toHaveBeenCalledWith(
        'user-1',
        '1',
      );
    });

    it('should throw NotFoundException if tenant not found', async () => {
      mockTenantProvider.findOneForUser.mockResolvedValue(null);

      const req = { user: { id: 'user-1' } } as unknown as Request & {
        user: { id: string };
      };
      await expect(controller.findOne('1', req)).rejects.toThrow(
        'Tenant not found',
      );
    });
  });

  describe('updateDetails', () => {
    it('should update tenant details', async () => {
      const tenant = {
        id: '1',
        name: 'Test Org',
        slug: 'test-org',
        logo: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        metadata: undefined,
        status: 'active' as const,
      };
      const updateDto = { name: 'Updated Org' };
      const updatedTenant = { ...tenant, name: 'Updated Org' };

      mockTenantProvider.findOneForUser.mockResolvedValue(tenant);
      mockTenantProvider.update.mockResolvedValue(updatedTenant);

      const req = { user: { id: 'user-1' } } as unknown as Request & {
        user: { id: string };
      };
      expect(await controller.updateDetails('1', updateDto, req)).toBe(
        updatedTenant,
      );
      expect(mockTenantProvider.findOneForUser).toHaveBeenCalledWith(
        'user-1',
        '1',
      );
      expect(mockTenantProvider.update).toHaveBeenCalledWith('1', updateDto);
    });

    it('should throw NotFoundException if tenant not found', async () => {
      mockTenantProvider.findOneForUser.mockResolvedValue(null);

      const req = { user: { id: 'user-1' } } as unknown as Request & {
        user: { id: string };
      };
      await expect(
        controller.updateDetails('1', { name: 'Updated' }, req),
      ).rejects.toThrow('Tenant not found');
    });
  });
});
