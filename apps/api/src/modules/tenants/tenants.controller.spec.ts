import { Test, TestingModule } from '@nestjs/testing';
import { TenantsController } from './tenants.controller';
import { TenantsService } from './tenants.service';
import { AuthGuard } from '../auth/auth.guard';
import { Organization } from '../../schema/better-auth';

describe('TenantsController', () => {
  let controller: TenantsController;
  let service: TenantsService;

  const mockTenantsService = {
    findAll: jest.fn(),
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
    service = module.get<TenantsService>(TenantsService);

    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('findAll', () => {
    it('should return an array of organizations', async () => {
      const result: Organization[] = [
        {
          id: '1',
          name: 'Test Org',
          slug: 'test-org',
          logo: null,
          createdAt: new Date(),
          metadata: null,
          status: 'active',
        },
      ];
      mockTenantsService.findAll.mockResolvedValue(result);

      expect(await controller.findAll()).toBe(result);
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(service.findAll).toHaveBeenCalled();
    });

    it('should verify search param is passed', async () => {
      const search = 'foo';
      await controller.findAll(search);
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(service.findAll).toHaveBeenCalledWith(search);
    });
  });

  describe('updateStatus', () => {
    it('should update status', async () => {
      const id = '1';
      const status = 'disabled';
      const result = { id, status };
      mockTenantsService.updateStatus.mockResolvedValue(result);

      expect(await controller.updateStatus(id, status)).toBe(result);
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(service.updateStatus).toHaveBeenCalledWith(id, status);
    });
  });
});
