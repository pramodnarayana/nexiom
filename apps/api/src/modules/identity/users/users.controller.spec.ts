import { Test, TestingModule } from '@nestjs/testing';
import { UsersController } from './users.controller';
import { USER_PROVIDER, TENANT_PROVIDER } from '@nexiom/identity';
import { Request } from 'express';
import { AuthGuard } from '../auth/auth.guard';
import { CreateUser } from './users.validation';
import { PermissionsGuard } from '../auth/permissions.guard';
import { NotFoundException } from '@nestjs/common';
import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';

describe('UsersController', () => {
  let controller: UsersController;
  let userProvider: {
    create: Mock;
    findAll: Mock;
    findById: Mock;
    findByEmail: Mock;
    update: Mock;
    delete: Mock;
    forceVerifyEmail: Mock;
    deleteIfNotLastAdmin: Mock;
  };
  let tenantProvider: {
    findAllForUser: Mock;
  };

  beforeEach(async () => {
    // vi.clearAllMocks() is redundant here as we create fresh mocks below

    userProvider = {
      create: vi.fn(),
      findAll: vi.fn(),
      findById: vi.fn(),
      findByEmail: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      forceVerifyEmail: vi.fn(),
      deleteIfNotLastAdmin: vi.fn(),
    };

    tenantProvider = {
      findAllForUser: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [
        {
          provide: USER_PROVIDER,
          useValue: userProvider,
        },
        {
          provide: TENANT_PROVIDER,
          useValue: tenantProvider,
        },
      ],
    })
      .overrideGuard(AuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<UsersController>(UsersController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('create', () => {
    it('should call userProvider.create with correct parameters', async () => {
      const createUser: CreateUser = {
        email: 'test@example.com',
        role: 'user',
      };
      const result = { id: '1', ...createUser };
      userProvider.create.mockResolvedValue(result);

      expect(await controller.create(createUser)).toEqual(result);

      expect(userProvider.create).toHaveBeenCalledWith(createUser);
    });
  });

  describe('findAll', () => {
    it('should return empty list if no organizationId in request', async () => {
      const req = {
        user: {},
      } as unknown as Request & { user: { organizationId?: string } };

      const result = await controller.findAll(req);
      expect(result).toEqual([]);

      expect(userProvider.findAll).not.toHaveBeenCalled();
    });

    it('should return empty list if user is undefined', async () => {
      const req = {} as unknown as Request & {
        user: { organizationId?: string };
      };

      const result = await controller.findAll(req);
      expect(result).toEqual([]);

      expect(userProvider.findAll).not.toHaveBeenCalled();
    });

    it('should call userProvider.findAll with tenantId if present', async () => {
      const tenantId = 'org-123';
      const req = {
        user: { organizationId: tenantId },
      } as unknown as Request & { user: { organizationId?: string } };
      const users = [{ id: '1', permissions: [] }];

      userProvider.findAll.mockResolvedValue({ data: users, total: 1 });

      const result = await controller.findAll(req);
      expect(result).toEqual({ data: users, total: 1 });

      expect(userProvider.findAll).toHaveBeenCalledWith({ tenantId });
    });
  });

  describe('findOne', () => {
    it('should call userProvider.findById and check tenant membership', async () => {
      const id = '1';
      const tenantId = 'org-123';
      const user = { id: '1', email: 'test@example.com', permissions: [] };
      const req = {
        user: { organizationId: tenantId },
      } as unknown as Request & { user: { organizationId?: string } };

      userProvider.findById.mockResolvedValue(user);
      tenantProvider.findAllForUser.mockResolvedValue([{ id: tenantId }]); // Is Member

      const result = await controller.findOne(id, req);
      expect(result).toEqual(user);

      expect(userProvider.findById).toHaveBeenCalledWith(id);
      expect(tenantProvider.findAllForUser).toHaveBeenCalledWith(id);
    });

    it('should throw NotFoundException if no tenantId (no context)', async () => {
      const id = '1';
      const req = {
        user: {},
      } as unknown as Request & { user: { organizationId?: string } };

      await expect(controller.findOne(id, req)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw NotFoundException if user not member of tenant', async () => {
      const id = '1';
      const tenantId = 'org-123';
      const user = { id: '1', email: 'test@example.com', permissions: [] };
      const req = {
        user: { organizationId: tenantId },
      } as unknown as Request & { user: { organizationId?: string } };

      userProvider.findById.mockResolvedValue(user);
      tenantProvider.findAllForUser.mockResolvedValue([{ id: 'other-org' }]); // Not Member

      await expect(controller.findOne(id, req)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('remove', () => {
    it('should throw BadRequestException if no organizationId (no context)', async () => {
      const id = 'user-123';
      const req = {
        user: { id: 'current-user' },
      } as unknown as Request & {
        user: { id: string; organizationId?: string };
      };

      await expect(controller.remove(id, req)).rejects.toThrow(
        'Organization context required',
      );
    });

    it('should throw BadRequestException if trying to delete self', async () => {
      const id = 'current-user';
      const tenantId = 'org-123';
      const req = {
        user: { id: 'current-user', organizationId: tenantId },
      } as unknown as Request & {
        user: { id: string; organizationId?: string };
      };

      await expect(controller.remove(id, req)).rejects.toThrow(
        'You cannot delete your own account.',
      );
    });

    it('should throw error if user not member of tenant', async () => {
      const id = 'user-123';
      const tenantId = 'org-123';
      const req = {
        user: { id: 'current-user', organizationId: tenantId },
      } as unknown as Request & {
        user: { id: string; organizationId?: string };
      };

      // Atomic operation throws error for non-member
      userProvider.deleteIfNotLastAdmin.mockRejectedValue(
        new Error('User is not a member of this organization'),
      );

      await expect(controller.remove(id, req)).rejects.toThrow(
        'User is not a member of this organization',
      );
    });

    it('should throw BadRequestException if trying to delete the last admin', async () => {
      const id = 'user-123';
      const tenantId = 'org-123';
      const req = {
        user: { id: 'current-user', organizationId: tenantId },
      } as unknown as Request & {
        user: { id: string; organizationId?: string };
      };

      // Atomic operation returns false when last admin
      userProvider.deleteIfNotLastAdmin.mockResolvedValue(false);

      await expect(controller.remove(id, req)).rejects.toThrow(
        'Cannot delete the last admin of the organization',
      );
    });

    it('should successfully delete user if all checks pass', async () => {
      const id = 'user-123';
      const tenantId = 'org-123';
      const req = {
        user: { id: 'current-user', organizationId: tenantId },
      } as unknown as Request & {
        user: { id: string; organizationId?: string };
      };

      // Atomic operation succeeds
      userProvider.deleteIfNotLastAdmin.mockResolvedValue(true);

      const result = await controller.remove(id, req);

      expect(result).toEqual({ success: true });
      expect(userProvider.deleteIfNotLastAdmin).toHaveBeenCalledWith(
        id,
        tenantId,
      );
    });

    it('should successfully delete admin if there are other admins', async () => {
      const id = 'user-123';
      const tenantId = 'org-123';
      const req = {
        user: { id: 'current-user', organizationId: tenantId },
      } as unknown as Request & {
        user: { id: string; organizationId?: string };
      };

      // Atomic operation succeeds (not last admin)
      userProvider.deleteIfNotLastAdmin.mockResolvedValue(true);

      const result = await controller.remove(id, req);

      expect(result).toEqual({ success: true });
      expect(userProvider.deleteIfNotLastAdmin).toHaveBeenCalledWith(
        id,
        tenantId,
      );
    });
  });
});
