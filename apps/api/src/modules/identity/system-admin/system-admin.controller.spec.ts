import { Test, TestingModule } from '@nestjs/testing';
import { SystemAdminController } from './system-admin.controller';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  AUTH_PROVIDER,
  USER_PROVIDER,
  TENANT_PROVIDER,
} from '@nexiom/identity';
import { SystemAdminGuard } from '../auth/system-admin.guard';
import { PlatformGuard } from '../auth/platform.guard';

describe('SystemAdminController', () => {
  let controller: SystemAdminController;
  const mockHeaders: Record<string, string> = {};

  const mockAuthProvider = {
    getSessionFromHeaders: jest.fn(),
    createInvitation: jest.fn(),
  };

  const mockUserProvider = {
    findById: jest.fn(),
    findByEmail: jest.fn(),
    findAll: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    count: jest.fn(),
  };

  const mockTenantProvider = {
    findById: jest.fn(),
    findBySlug: jest.fn(),
    findAll: jest.fn(),
    createTenant: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [SystemAdminController],
      providers: [
        { provide: AUTH_PROVIDER, useValue: mockAuthProvider },
        { provide: USER_PROVIDER, useValue: mockUserProvider },
        { provide: TENANT_PROVIDER, useValue: mockTenantProvider },
      ],
    })
      .overrideGuard(SystemAdminGuard)
      .useValue({ canActivate: jest.fn(() => true) })
      .overrideGuard(PlatformGuard)
      .useValue({ canActivate: jest.fn(() => true) })
      .compile();

    controller = module.get<SystemAdminController>(SystemAdminController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('listUsers', () => {
    it('should return paginated users and total count', async () => {
      const mockResult = { data: [{ id: '1', name: 'User 1' }], total: 1 };
      mockUserProvider.findAll.mockResolvedValue(mockResult);

      const result = await controller.listUsers('1', '10');

      expect(result).toEqual(mockResult);
      expect(mockUserProvider.findAll).toHaveBeenCalledWith({
        page: 1,
        limit: 10,
      });
    });

    it('should use default pagination parameters', async () => {
      mockUserProvider.findAll.mockResolvedValue({ data: [], total: 0 });

      await controller.listUsers(); // Defaults

      expect(mockUserProvider.findAll).toHaveBeenCalledWith({
        page: 1,
        limit: 10,
      });
    });
  });

  describe('createSystemInvitation', () => {
    it('should throw BadRequestException if unauthorized', async () => {
      mockAuthProvider.getSessionFromHeaders.mockResolvedValue(null);

      await expect(
        controller.createSystemInvitation(
          { email: 'test@example.com', role: 'platform_admin' },
          mockHeaders,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(mockAuthProvider.createInvitation).not.toHaveBeenCalled();
    });

    it('should create system invitation', async () => {
      mockAuthProvider.getSessionFromHeaders.mockResolvedValue({
        user: { id: 'admin1' },
      });
      const mockInvitation = { id: 'inv1', email: 'test@example.com' };
      mockAuthProvider.createInvitation.mockResolvedValue(mockInvitation);

      const result = await controller.createSystemInvitation(
        { email: 'test@example.com', role: 'platform_admin' },
        mockHeaders,
      );

      expect(result).toEqual(mockInvitation);
      expect(mockAuthProvider.getSessionFromHeaders).toHaveBeenCalled();
      expect(mockAuthProvider.createInvitation).toHaveBeenCalledWith({
        email: 'test@example.com',
        role: 'platform_admin',
        organizationId: null,
        inviterId: 'admin1',
      });
    });
  });

  describe('listTenants', () => {
    it('should return paginated tenants', async () => {
      const mockResult = { data: [{ id: 't1', name: 'Tenant 1' }], total: 1 };
      mockTenantProvider.findAll.mockResolvedValue(mockResult);

      const result = await controller.listTenants('1', '10');

      expect(result).toEqual(mockResult);
      expect(mockTenantProvider.findAll).toHaveBeenCalledWith({
        page: 1,
        limit: 10,
      });
    });
  });

  describe('getTenant', () => {
    it('should return a tenant by ID', async () => {
      const mockTenant = { id: 't1', name: 'Tenant 1' };
      mockTenantProvider.findById.mockResolvedValue(mockTenant);

      const result = await controller.getTenant('t1');

      expect(result).toEqual(mockTenant);
      expect(mockTenantProvider.findById).toHaveBeenCalledWith('t1');
    });

    it('should throw NotFoundException if tenant not found', async () => {
      mockTenantProvider.findById.mockResolvedValue(null);

      await expect(controller.getTenant('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('createTenant', () => {
    it('should throw BadRequestException if slug exists', async () => {
      mockTenantProvider.findBySlug.mockResolvedValue({ id: 'existing' });

      await expect(
        controller.createTenant({
          name: 'Test',
          slug: 'test',
          logo: '',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should create tenant via provider if slug is unique', async () => {
      mockTenantProvider.findBySlug.mockResolvedValue(null);
      const mockCreated = { id: 'new', slug: 'test' };
      mockTenantProvider.createTenant.mockResolvedValue(mockCreated);

      const result = await controller.createTenant({
        name: 'Test',
        slug: 'test',
        logo: '',
      });

      expect(result).toEqual(mockCreated);
      expect(mockTenantProvider.createTenant).toHaveBeenCalledWith({
        name: 'Test',
        slug: 'test',
        logo: '',
      });
    });
  });

  describe('createUser', () => {
    it('should throw BadRequestException if email exists', async () => {
      mockUserProvider.findByEmail.mockResolvedValue({ id: 'existing' });

      await expect(
        controller.createUser({
          name: 'Test',
          email: 'taken@example.com',
          systemRole: 'platform_user',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should create user via provider', async () => {
      mockUserProvider.findByEmail.mockResolvedValue(null);
      const mockUser = {
        id: 'u1',
        email: 'new@example.com',
        systemRole: 'platform_user',
      };
      mockUserProvider.create.mockResolvedValue(mockUser);

      const result = await controller.createUser({
        name: 'Test',
        email: 'new@example.com',
        systemRole: 'platform_user',
      });

      expect(result).toEqual(mockUser);
      expect(mockUserProvider.create).toHaveBeenCalledWith({
        name: 'Test',
        email: 'new@example.com',
        systemRole: 'platform_user',
      });
      expect(mockUserProvider.update).not.toHaveBeenCalled();
    });
  });

  describe('updateTenant', () => {
    it('should throw NotFoundException if tenant not found', async () => {
      mockTenantProvider.findById.mockResolvedValue(null);

      await expect(
        controller.updateTenant('missing', { name: 'New' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException if slug overlaps', async () => {
      mockTenantProvider.findById.mockResolvedValue({
        id: 't1',
        slug: 'old-slug',
      });
      mockTenantProvider.findBySlug.mockResolvedValue({
        id: 't2', // diff ID
        slug: 'taken',
      });

      await expect(
        controller.updateTenant('t1', { slug: 'taken' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should update tenant via provider', async () => {
      mockTenantProvider.findById.mockResolvedValue({ id: 't1' });
      // Slug check: returns null or same ID
      mockTenantProvider.findBySlug.mockResolvedValue(null);
      const mockUpdated = { id: 't1', name: 'New' };
      mockTenantProvider.update.mockResolvedValue(mockUpdated);

      const result = await controller.updateTenant('t1', { name: 'New' });

      expect(result).toEqual(mockUpdated);
      expect(mockTenantProvider.update).toHaveBeenCalledWith('t1', {
        name: 'New',
      });
    });
  });

  describe('deleteTenant', () => {
    it('should throw NotFoundException if tenant not found', async () => {
      mockTenantProvider.findById.mockResolvedValue(null);

      await expect(controller.deleteTenant('missing')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should delete tenant via provider', async () => {
      mockTenantProvider.findById.mockResolvedValue({ id: 't1' });

      await controller.deleteTenant('t1');

      expect(mockTenantProvider.delete).toHaveBeenCalledWith('t1');
    });
  });

  describe('updateUser', () => {
    it('should throw NotFoundException if user not found', async () => {
      mockUserProvider.findById.mockResolvedValue(null);

      await expect(
        controller.updateUser('missing', { name: 'New' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException if email overlaps', async () => {
      mockUserProvider.findById.mockResolvedValue({
        id: 'u1',
        email: 'old@example.com',
      });
      mockUserProvider.findByEmail.mockResolvedValue({
        id: 'u2', // Diff ID
        email: 'taken@example.com',
      });

      await expect(
        controller.updateUser('u1', { email: 'taken@example.com' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should update user via provider', async () => {
      mockUserProvider.findById.mockResolvedValue({ id: 'u1' });
      mockUserProvider.update.mockResolvedValue({ id: 'u1', name: 'New' });

      const result = await controller.updateUser('u1', { name: 'New' });

      expect(result).toEqual({ id: 'u1', name: 'New' });
      expect(mockUserProvider.update).toHaveBeenCalledWith('u1', {
        name: 'New',
      });
    });
  });

  describe('getUser', () => {
    it('should return user by ID', async () => {
      const mockUser = { id: 'u1' };
      mockUserProvider.findById.mockResolvedValue(mockUser);

      const result = await controller.getUser('u1');

      expect(result).toEqual(mockUser);
    });

    it('should throw NotFoundException if user not found', async () => {
      mockUserProvider.findById.mockResolvedValue(null);

      await expect(controller.getUser('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('deleteUser', () => {
    it('should throw NotFoundException if user not found', async () => {
      mockUserProvider.findById.mockResolvedValue(null);

      await expect(controller.deleteUser('missing')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should prevent deleting the last platform admin', async () => {
      mockUserProvider.findById.mockResolvedValue({
        id: 'admin1',
        systemRole: 'platform_admin',
      });
      // count returns 1 (only this user left)
      mockUserProvider.count.mockResolvedValue(1);

      await expect(controller.deleteUser('admin1')).rejects.toThrow(
        BadRequestException,
      );
      expect(mockUserProvider.count).toHaveBeenCalledWith({
        systemRole: 'platform_admin',
      });
    });

    it('should allow deleting platform admin if others exist', async () => {
      mockUserProvider.findById.mockResolvedValue({
        id: 'admin1',
        systemRole: 'platform_admin',
      });
      // count returns 2
      mockUserProvider.count.mockResolvedValue(2);

      await controller.deleteUser('admin1');

      expect(mockUserProvider.delete).toHaveBeenCalledWith('admin1');
    });

    it('should delete normal user', async () => {
      mockUserProvider.findById.mockResolvedValue({
        id: 'u1',
        systemRole: 'platform_user',
      });

      await controller.deleteUser('u1');

      expect(mockUserProvider.delete).toHaveBeenCalledWith('u1');
      // Should not check admin count for normal user
      expect(mockUserProvider.count).not.toHaveBeenCalled();
    });
  });

  describe('inviteUser', () => {
    it('should throw NotFoundException if user not found', async () => {
      mockUserProvider.findById.mockResolvedValue(null);

      await expect(
        controller.inviteUser('missing', mockHeaders),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException if unauthorized', async () => {
      mockUserProvider.findById.mockResolvedValue({ id: 'u1' });
      mockAuthProvider.getSessionFromHeaders.mockResolvedValue(null);

      await expect(controller.inviteUser('u1', mockHeaders)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should create system invite', async () => {
      mockUserProvider.findById.mockResolvedValue({
        id: 'u1',
        email: 'test@example.com',
        systemRole: 'platform_admin',
      });
      mockAuthProvider.getSessionFromHeaders.mockResolvedValue({
        user: { id: 'admin1' },
      });

      await controller.inviteUser('u1', mockHeaders);

      expect(mockAuthProvider.createInvitation).toHaveBeenCalledWith({
        email: 'test@example.com',
        role: 'platform_admin',
        organizationId: null, // System invite
        inviterId: 'admin1',
      });
    });
  });
});
