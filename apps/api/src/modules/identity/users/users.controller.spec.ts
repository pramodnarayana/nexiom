import { Test, TestingModule } from '@nestjs/testing';
import { UsersController } from './users.controller';
import { USER_PROVIDER, TENANT_PROVIDER } from '@nexiom/identity';
import { Request } from 'express';
import { AuthGuard } from '../auth/auth.guard';
import { CreateUser } from './users.validation';
import { PermissionsGuard } from '../auth/permissions.guard';
import { NotFoundException } from '@nestjs/common';

describe('UsersController', () => {
  let controller: UsersController;
  let mockUserProvider: {
    create: jest.Mock;
    findAll: jest.Mock;
    findById: jest.Mock;
    findByEmail: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
    forceVerifyEmail: jest.Mock;
  };
  let mockTenantProvider: {
    findAllForUser: jest.Mock;
  };

  beforeEach(async () => {
    mockUserProvider = {
      create: jest.fn(),
      findAll: jest.fn(),
      findById: jest.fn(),
      findByEmail: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      forceVerifyEmail: jest.fn(),
    };

    mockTenantProvider = {
      findAllForUser: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [
        {
          provide: USER_PROVIDER,
          useValue: mockUserProvider,
        },
        {
          provide: TENANT_PROVIDER,
          useValue: mockTenantProvider,
        },
      ],
    })
      .overrideGuard(AuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<UsersController>(UsersController);
    jest.clearAllMocks();
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
      mockUserProvider.create.mockResolvedValue(result);

      expect(await controller.create(createUser)).toEqual(result);

      expect(mockUserProvider.create).toHaveBeenCalledWith(createUser);
    });
  });

  describe('findAll', () => {
    it('should return empty list if no organizationId in request', async () => {
      const req = {
        user: {},
      } as unknown as Request & { user: { organizationId?: string } };

      const result = await controller.findAll(req);
      expect(result).toEqual([]);

      expect(mockUserProvider.findAll).not.toHaveBeenCalled();
    });

    it('should return empty list if user is undefined', async () => {
      const req = {} as unknown as Request & {
        user: { organizationId?: string };
      };

      const result = await controller.findAll(req);
      expect(result).toEqual([]);

      expect(mockUserProvider.findAll).not.toHaveBeenCalled();
    });

    it('should call userProvider.findAll with tenantId if present', async () => {
      const tenantId = 'org-123';
      const req = {
        user: { organizationId: tenantId },
      } as unknown as Request & { user: { organizationId?: string } };
      const users = [{ id: '1' }];

      mockUserProvider.findAll.mockResolvedValue({ data: users, total: 1 });

      const result = await controller.findAll(req);
      expect(result).toEqual({ data: users, total: 1 });

      expect(mockUserProvider.findAll).toHaveBeenCalledWith({ tenantId });
    });
  });

  describe('findOne', () => {
    it('should call userProvider.findById and check tenant membership', async () => {
      const id = '1';
      const tenantId = 'org-123';
      const user = { id: '1', email: 'test@example.com' };
      const req = {
        user: { organizationId: tenantId },
      } as unknown as Request & { user: { organizationId?: string } };

      mockUserProvider.findById.mockResolvedValue(user);
      mockTenantProvider.findAllForUser.mockResolvedValue([{ id: tenantId }]); // Is Member

      const result = await controller.findOne(id, req);
      expect(result).toEqual(user);

      expect(mockUserProvider.findById).toHaveBeenCalledWith(id);
      expect(mockTenantProvider.findAllForUser).toHaveBeenCalledWith(id);
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
      const user = { id: '1', email: 'test@example.com' };
      const req = {
        user: { organizationId: tenantId },
      } as unknown as Request & { user: { organizationId?: string } };

      mockUserProvider.findById.mockResolvedValue(user);
      mockTenantProvider.findAllForUser.mockResolvedValue([
        { id: 'other-org' },
      ]); // Not Member

      await expect(controller.findOne(id, req)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
