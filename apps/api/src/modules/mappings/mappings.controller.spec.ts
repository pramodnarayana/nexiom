/* eslint-disable @typescript-eslint/no-unsafe-argument */
import { Test, TestingModule } from '@nestjs/testing';
import { MappingsController } from './mappings.controller.js';
import { MappingsService } from './mappings.service.js';
import { CreateMapping, UpdateMapping } from './mappings.validation.js';
import { SystemAdminGuard } from '../identity/auth/system-admin.guard.js';

describe('MappingsController', () => {
  let controller: MappingsController;
  let service: MappingsService;

  beforeEach(async () => {
    const mockMappingsService = {
      create: vi.fn(),
      findAll: vi.fn(),
      findOne: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [MappingsController],
      providers: [
        {
          provide: MappingsService,
          useValue: mockMappingsService,
        },
      ],
    })
      .overrideGuard(SystemAdminGuard)
      .useValue({ canActivate: () => true }) // Just mock the guard broadly to test the pure controller flow
      .compile();

    controller = module.get<MappingsController>(MappingsController);
    service = module.get<MappingsService>(MappingsService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('create() should map to service.create', async () => {
    const payload = new CreateMapping();
    const spy = vi.spyOn(service, 'create').mockResolvedValue({} as any);
    await controller.create(payload);
    expect(spy).toHaveBeenCalledWith(payload);
  });

  it('findAll() should map to service.findAll', async () => {
    const spy = vi.spyOn(service, 'findAll').mockResolvedValue([] as any);
    await controller.findAll();
    expect(spy).toHaveBeenCalled();
  });

  it('findOne() should map to service.findOne', async () => {
    const spy = vi.spyOn(service, 'findOne').mockResolvedValue({} as any);
    await controller.findOne('abc');
    expect(spy).toHaveBeenCalledWith('abc');
  });

  it('updatePartial() should map to service.update', async () => {
    const payload = new UpdateMapping();
    const spy = vi.spyOn(service, 'update').mockResolvedValue({} as any);
    await controller.updatePartial('abc', payload);
    expect(spy).toHaveBeenCalledWith('abc', payload);
  });

  it('update() should map to service.update', async () => {
    const payload = new UpdateMapping();
    const spy = vi.spyOn(service, 'update').mockResolvedValue({} as any);
    await controller.update('abc', payload);
    expect(spy).toHaveBeenCalledWith('abc', payload);
  });

  it('remove() should map to service.remove', async () => {
    const spy = vi.spyOn(service, 'remove').mockResolvedValue({} as any);
    await controller.remove('abc');
    expect(spy).toHaveBeenCalledWith('abc');
  });
});
