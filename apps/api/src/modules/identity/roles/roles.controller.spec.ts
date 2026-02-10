import { Test, TestingModule } from '@nestjs/testing';
import { RolesController } from './roles.controller';
import { ROLE_PROVIDER, RoleScope } from '@nexiom/identity';
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
      const roles = [
        {
          id: 'admin',
          name: 'Admin',
          isSystem: true,
          createdAt: new Date(),
          description: null,
        },
      ];
      roleProvider.findAll.mockResolvedValue(roles);

      const result = await controller.findAll(RoleScope.System);

      expect(result).toEqual({ data: roles });
      expect(roleProvider.findAll).toHaveBeenCalledWith({
        scope: RoleScope.System,
      });
    });

    it('should handle provider errors', async () => {
      roleProvider.findAll.mockRejectedValue(new Error('Provider Error'));

      await expect(controller.findAll()).rejects.toThrow('Provider Error');
    });

    it('should handle provider errors with scope', async () => {
      roleProvider.findAll.mockRejectedValue(new Error('Provider Error'));

      await expect(controller.findAll(RoleScope.System)).rejects.toThrow(
        'Provider Error',
      );
    });
  });

  describe('create', () => {
    it('should create a role using provider', async () => {
      const newRole = { name: 'Editor', description: 'Can edit' };
      const createdRole = { id: 'editor', ...newRole };
      roleProvider.create.mockResolvedValue(createdRole);

      const result = await controller.create(newRole);

      expect(result).toEqual({ data: createdRole });
      expect(roleProvider.create).toHaveBeenCalledWith(newRole);
    });
  });

  describe('findById', () => {
    it('should return a role by id', async () => {
      const role = { id: 'admin', name: 'Admin' };
      roleProvider.findById.mockResolvedValue(role);

      const result = await controller.findById('admin');

      expect(result).toEqual({ data: role });
      expect(roleProvider.findById).toHaveBeenCalledWith('admin');
    });

    it('should handle not found error', async () => {
      roleProvider.findById.mockResolvedValue(null);

      const result = await controller.findById('unknown');
      expect(result).toEqual({ data: null });
    });
  });

  describe('update', () => {
    it('should update a role', async () => {
      const updateData = { description: 'Updated' };
      const updatedRole = {
        id: 'admin',
        name: 'Admin',
        description: 'Updated',
      };
      roleProvider.update.mockResolvedValue(updatedRole);

      const result = await controller.update('admin', updateData);

      expect(result).toEqual({ data: updatedRole });
      expect(roleProvider.update).toHaveBeenCalledWith('admin', updateData);
    });
  });

  describe('delete', () => {
    it('should delete a role', async () => {
      roleProvider.delete.mockResolvedValue(undefined);

      const result = await controller.delete('admin');

      expect(result).toEqual({ data: { deleted: true } }); // Controller returns this structure
      expect(roleProvider.delete).toHaveBeenCalledWith('admin');
    });

    it('should handle delete failure/not found', async () => {
      roleProvider.delete.mockRejectedValue(new Error('Not found'));

      await expect(controller.delete('unknown')).rejects.toThrow('Not found');
      expect(roleProvider.delete).toHaveBeenCalledWith('unknown');
    });
  });
});
