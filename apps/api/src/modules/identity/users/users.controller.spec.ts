import { Test, TestingModule } from '@nestjs/testing';
import { UsersController } from './users.controller.js';
import {
  ListUsersWithInvitationsUseCase,
  RemoveUserUseCase,
  GetUserProfileUseCase,
  CreateUserUseCase,
  GetUserByIdUseCase,
} from '@soopa/identity';
import { Request } from 'express';
import { AuthGuard, PermissionsGuard } from '@soopa/auth';
import { CreateUser } from './users.validation.js';
import {
  NotFoundException,
  InternalServerErrorException,
  BadRequestException,
} from '@nestjs/common';
import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';

describe('UsersController', () => {
  let controller: UsersController;
  let listUsersWithInvitationsUseCase: { execute: Mock };
  let removeUserUseCase: { execute: Mock };
  let getUserProfileUseCase: { execute: Mock };
  let createUserUseCase: { execute: Mock };
  let getUserByIdUseCase: { execute: Mock };

  beforeEach(async () => {
    listUsersWithInvitationsUseCase = { execute: vi.fn() };
    removeUserUseCase = { execute: vi.fn() };
    getUserProfileUseCase = { execute: vi.fn() };
    createUserUseCase = { execute: vi.fn() };
    getUserByIdUseCase = { execute: vi.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [
        {
          provide: ListUsersWithInvitationsUseCase,
          useValue: listUsersWithInvitationsUseCase,
        },
        {
          provide: RemoveUserUseCase,
          useValue: removeUserUseCase,
        },
        {
          provide: GetUserProfileUseCase,
          useValue: getUserProfileUseCase,
        },
        {
          provide: CreateUserUseCase,
          useValue: createUserUseCase,
        },
        {
          provide: GetUserByIdUseCase,
          useValue: getUserByIdUseCase,
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

  describe('getMe', () => {
    it('should call getUserProfileUseCase with the correct user ID', async () => {
      const req = { user: { id: 'user-1' } } as unknown as Request & {
        user: { id: string };
      };
      const userProfile = { id: 'user-1', email: 'test@example.com' };
      getUserProfileUseCase.execute.mockResolvedValue(userProfile);

      const result = await controller.getMe(req);

      expect(result).toEqual(userProfile);
      expect(getUserProfileUseCase.execute).toHaveBeenCalledWith('user-1');
    });
  });

  describe('create', () => {
    it('should call createUserUseCase with the correct payload', async () => {
      const createUserDto: CreateUser = {
        email: 'test@example.com',
        role: 'member',
      };
      const createdUser = { id: 'new-user', ...createUserDto };
      createUserUseCase.execute.mockResolvedValue(createdUser);

      const result = await controller.create(createUserDto);

      expect(result).toEqual(createdUser);
      expect(createUserUseCase.execute).toHaveBeenCalledWith(createUserDto);
    });
  });

  describe('findAll', () => {
    it('should return empty list if no organizationId is present', async () => {
      const req = { user: {} } as unknown as Request & {
        user: { organizationId?: string };
      };

      const result = await controller.findAll(req);

      expect(result).toEqual({ data: [], total: 0 });
      expect(listUsersWithInvitationsUseCase.execute).not.toHaveBeenCalled();
    });

    it('should return empty list if user is undefined', async () => {
      const req = {} as unknown as Request & {
        user: { organizationId?: string };
      };

      const result = await controller.findAll(req);

      expect(result).toEqual({ data: [], total: 0 });
      expect(listUsersWithInvitationsUseCase.execute).not.toHaveBeenCalled();
    });

    it('should call listUsersWithInvitationsUseCase if organizationId is present', async () => {
      const tenantId = 'org-123';
      const req = {
        user: { organizationId: tenantId },
      } as unknown as Request & { user: { organizationId?: string } };
      const response = { data: [{ id: 'user-1', type: 'user' }], total: 1 };
      listUsersWithInvitationsUseCase.execute.mockResolvedValue(response);

      const result = await controller.findAll(req);

      expect(result).toEqual(response);
      expect(listUsersWithInvitationsUseCase.execute).toHaveBeenCalledWith(
        tenantId,
      );
    });
  });

  describe('findOne', () => {
    it('should call getUserByIdUseCase and return the user', async () => {
      const id = '1';
      const tenantId = 'org-123';
      const req = {
        user: { organizationId: tenantId },
      } as unknown as Request & { user: { organizationId?: string } };
      const user = { id: '1', email: 'test@example.com' };

      getUserByIdUseCase.execute.mockResolvedValue(user);

      const result = await controller.findOne(id, req);

      expect(result).toEqual(user);
      expect(getUserByIdUseCase.execute).toHaveBeenCalledWith(id, tenantId);
    });

    it('should propagate errors from the use case (e.g. NotFoundException)', async () => {
      const id = '1';
      const tenantId = 'org-123';
      const req = {
        user: { organizationId: tenantId },
      } as unknown as Request & { user: { organizationId?: string } };

      getUserByIdUseCase.execute.mockRejectedValue(
        new NotFoundException('User not found'),
      );

      await expect(controller.findOne(id, req)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('remove', () => {
    it('should throw BadRequestException if no organizationId in context', async () => {
      const id = 'user-123';
      const req = { user: { id: 'admin' } } as unknown as Request & {
        user: { id: string; organizationId?: string };
      };

      await expect(controller.remove(id, req)).rejects.toThrow(
        BadRequestException,
      );
      expect(removeUserUseCase.execute).not.toHaveBeenCalled();
    });

    it('should successfully remove a user', async () => {
      const id = 'user-123';
      const req = {
        user: { id: 'admin', organizationId: 'org-123' },
      } as unknown as Request & {
        user: { id: string; organizationId?: string };
      };
      const response = { success: true, hardDeleted: true };

      removeUserUseCase.execute.mockResolvedValue(response);

      const result = await controller.remove(id, req);

      expect(result).toEqual(response);
      expect(removeUserUseCase.execute).toHaveBeenCalledWith(
        id,
        'admin',
        'org-123',
      );
    });

    it('should propagate BadRequestException from use case', async () => {
      const id = 'user-123';
      const req = {
        user: { id: 'admin', organizationId: 'org-123' },
      } as unknown as Request & {
        user: { id: string; organizationId?: string };
      };

      removeUserUseCase.execute.mockRejectedValue(
        new BadRequestException('Cannot delete self'),
      );

      await expect(controller.remove(id, req)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should propagate NotFoundException from use case', async () => {
      const id = 'user-123';
      const req = {
        user: { id: 'admin', organizationId: 'org-123' },
      } as unknown as Request & {
        user: { id: string; organizationId?: string };
      };

      removeUserUseCase.execute.mockRejectedValue(
        new NotFoundException('User not found'),
      );

      await expect(controller.remove(id, req)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should wrap unknown errors in InternalServerErrorException', async () => {
      const id = 'user-123';
      const req = {
        user: { id: 'admin', organizationId: 'org-123' },
      } as unknown as Request & {
        user: { id: string; organizationId?: string };
      };

      removeUserUseCase.execute.mockRejectedValue(
        new Error('Unexpected DB error'),
      );

      await expect(controller.remove(id, req)).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });
});
