import { Test, TestingModule } from '@nestjs/testing';
import { RolesController } from './roles.controller.js';
import { ROLE_REPOSITORY, RoleScope } from '@soopa/identity';
import {
  AuthGuard,
  PermissionsGuard,
  type RequestAuthContext,
} from '@soopa/auth';
import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { NotFoundException } from '@nestjs/common';

describe('RolesController', () => {
  let controller: RolesController;
  let roleProvider: {
    findAll: Mock;
    create: Mock;
    findById: Mock;
    update: Mock;
    delete: Mock;
  };

  const mockContext = {
    headers: new Headers(),
    user: { memberRole: 'owner' },
    session: { id: 'test-session' },
  } as unknown as RequestAuthContext;

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
          provide: ROLE_REPOSITORY,
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
    const mockCtx = {
      headers: new Headers(),
      user: { id: 'u1', role: 'admin', memberRole: 'admin' },
      session: { id: 's1', token: 't1' },
    } as unknown as RequestAuthContext;

    it('should return roles from provider', async () => {
      const roles = [{ id: 'admin', name: 'Admin' }];
      roleProvider.findAll.mockResolvedValue(roles);

      const result = await controller.findAll(mockCtx);

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

      const result = await controller.findAll(mockCtx, RoleScope.System);

      expect(result).toEqual({ data: roles });
      expect(roleProvider.findAll).toHaveBeenCalledWith({
        scope: RoleScope.System,
      });
    });

    it('should filter out Owner role for non-owner users', async () => {
      const roles = [
        { id: 'owner', name: 'Owner' },
        { id: 'admin', name: 'admin' },
        { id: 'member', name: 'member' },
      ];
      roleProvider.findAll.mockResolvedValue(roles);

      const result = await controller.findAll(mockCtx);

      expect(result).toEqual({
        data: [
          { id: 'admin', name: 'admin' },
          { id: 'member', name: 'member' },
        ],
      });
    });

    it('should include Owner role for owner users', async () => {
      const ownerCtx = {
        ...mockCtx,
        user: { id: 'u1', memberRole: 'owner' },
      } as unknown as RequestAuthContext;
      const roles = [
        { id: 'owner', name: 'Owner' },
        { id: 'admin', name: 'admin' },
      ];
      roleProvider.findAll.mockResolvedValue(roles);

      const result = await controller.findAll(ownerCtx);

      expect(result).toEqual({ data: roles });
    });

    it('should handle provider errors', async () => {
      roleProvider.findAll.mockRejectedValue(new Error('Provider Error'));

      await expect(controller.findAll(mockCtx)).rejects.toThrow(
        'Provider Error',
      );
    });

    it('should handle provider errors with scope', async () => {
      roleProvider.findAll.mockRejectedValue(new Error('Provider Error'));

      await expect(
        controller.findAll(mockCtx, RoleScope.System),
      ).rejects.toThrow('Provider Error');
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

      const result = await controller.findById('admin', mockContext);

      expect(result).toEqual({ data: role });
      expect(roleProvider.findById).toHaveBeenCalledWith('admin');
    });

    it('should handle not found error', async () => {
      roleProvider.findById.mockResolvedValue(null);

      await expect(controller.findById('unknown', mockContext)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw NotFoundException if role is not visible to requester', async () => {
      const role = { id: 'owner', name: 'Owner' };
      roleProvider.findById.mockResolvedValue(role);
      const memberCtx = {
        ...mockContext,
        user: { memberRole: 'member' },
      } as unknown as RequestAuthContext;

      await expect(controller.findById('owner', memberCtx)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    it('should update a role', async () => {
      const updateData = { description: 'Updated' };
      const existingRole = { id: 'admin', name: 'Admin', description: 'Old' };
      const updatedRole = {
        id: 'admin',
        name: 'Admin',
        description: 'Updated',
      };
      roleProvider.findById.mockResolvedValue(existingRole); // Mock findById for permission check
      roleProvider.update.mockResolvedValue(updatedRole);

      const result = await controller.update('admin', updateData, mockContext);

      expect(result).toEqual({ data: updatedRole });
      expect(roleProvider.update).toHaveBeenCalledWith('admin', updateData);
    });

    it('should throw NotFoundException if role to update is not visible', async () => {
      const existingRole = { id: 'owner', name: 'Owner' };
      roleProvider.findById.mockResolvedValue(existingRole);
      const memberCtx = {
        ...mockContext,
        user: { memberRole: 'member' },
      } as unknown as RequestAuthContext;

      await expect(controller.update('owner', {}, memberCtx)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw NotFoundException if role to update does not exist', async () => {
      roleProvider.findById.mockResolvedValue(null);

      await expect(
        controller.update('unknown', {}, mockContext),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('delete', () => {
    it('should delete a role', async () => {
      const existingRole = { id: 'admin', name: 'Admin' };
      roleProvider.findById.mockResolvedValue(existingRole); // Mock findById for permission check
      roleProvider.delete.mockResolvedValue(undefined); // Provider delete might return void or a success indicator

      const result = await controller.delete('admin', mockContext);

      expect(result).toEqual({ data: { deleted: true } }); // Controller returns this structure
      expect(roleProvider.delete).toHaveBeenCalledWith('admin');
    });

    it('should handle delete failure/not found', async () => {
      roleProvider.findById.mockResolvedValue(null); // Role not found by findById

      await expect(controller.delete('unknown', mockContext)).rejects.toThrow(
        NotFoundException, // Assuming controller throws NotFoundException if findById returns null
      );
      expect(roleProvider.delete).not.toHaveBeenCalled(); // delete is NOT called if findById returns null
    });

    it('should throw NotFoundException if role to delete is not visible', async () => {
      const existingRole = { id: 'owner', name: 'Owner' };
      roleProvider.findById.mockResolvedValue(existingRole);
      const memberCtx = {
        ...mockContext,
        user: { memberRole: 'member' },
      } as unknown as RequestAuthContext;

      await expect(controller.delete('owner', memberCtx)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
