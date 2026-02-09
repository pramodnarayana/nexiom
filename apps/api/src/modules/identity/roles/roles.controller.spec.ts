import { Test, TestingModule } from '@nestjs/testing';
import { RolesController } from './roles.controller';
import { ROLE_PROVIDER } from '@nexiom/identity';
import { AuthGuard } from '../auth/auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';

describe('RolesController', () => {
  let controller: RolesController;
  let roleProvider: {
    findAll: Mock;
    create: Mock;
    findById: Mock;
    update: Mock;
    delete: Mock;
  };

  beforeEach(async () => {
    roleProvider = {
      findAll: vi.fn(),
      create: vi.fn(),
      findById: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [RolesController],
      providers: [
        {
          provide: ROLE_PROVIDER,
          useValue: roleProvider,
        },
      ],
    })
      .overrideGuard(AuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<RolesController>(RolesController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('findAll', () => {
    it('should return roles from provider', async () => {
      const roles = [{ id: 'admin', name: 'Admin' }];
      roleProvider.findAll.mockResolvedValue(roles);

      const result = await controller.findAll();

      expect(result).toEqual({ data: roles });
      expect(roleProvider.findAll).toHaveBeenCalledWith({ scope: undefined });
    });

    it('should pass scope to provider', async () => {
      const roles = [{ id: 'admin', name: 'Admin' }];
      roleProvider.findAll.mockResolvedValue(roles);

      await controller.findAll('system');

      expect(roleProvider.findAll).toHaveBeenCalledWith({ scope: 'system' });
    });
  });
});
