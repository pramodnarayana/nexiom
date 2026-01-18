import { Test, TestingModule } from '@nestjs/testing';
import { Request } from 'express';
import { TenantsController } from './tenants.controller';
import { TenantsService } from './tenants.service';
import { AuthGuard } from '../auth/auth.guard';
import { Organization } from './tenant.schema';
import { UpdateTenantStatus } from './tenants.validation';

describe('TenantsController', () => {
  let controller: TenantsController;

  const mockTenantsService = {
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
          provide: TenantsService,
          useValue: mockTenantsService,
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
      const result: Organization[] = [
        {
          id: '1',
          name: 'Test Org',
          slug: 'test-org',
          logo: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          metadata: null,
          status: 'active',
        },
      ];
      mockTenantsService.findAllForUser.mockResolvedValue(result);

      const req = { user: { id: 'user-1' } } as unknown as Request & {
        user: { id: string };
      };
      expect(await controller.findAll(req)).toBe(result);
      expect(mockTenantsService.findAllForUser).toHaveBeenCalledWith('user-1');
    });
  });

  describe('updateStatus', () => {
    it('should update status', async () => {
      const id = '1';
      const status: UpdateTenantStatus = { status: 'disabled' };
      const result = { id, status: status.status };
      mockTenantsService.updateStatus.mockResolvedValue(result);

      expect(await controller.updateStatus(id, status)).toBe(result);
      expect(mockTenantsService.updateStatus).toHaveBeenCalledWith(
        id,
        status.status,
      );
    });
  });
});
