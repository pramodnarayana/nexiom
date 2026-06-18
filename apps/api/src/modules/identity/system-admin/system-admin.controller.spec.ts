/* eslint-disable @typescript-eslint/no-unused-vars */
import { Test, TestingModule } from '@nestjs/testing';
import { SystemAdminController } from './system-admin.controller.js';
import {
  BadRequestException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import {
  AUTH_PROVIDER,
  USER_REPOSITORY,
  TENANT_REPOSITORY,
  ROLE_REPOSITORY,
} from '@soopa/identity';
import {
  getRequiredAdminRoleId,
  getRequiredOwnerRoleId,
  getRequiredSystemTenantId,
} from '../../../constants.js';
import { SystemAdminGuard } from '../auth/system-admin.guard.js';
import {
  AuthGuard,
  PermissionsGuard,
  type RequestAuthContext,
} from '@soopa/auth';
import { PlatformGuard } from '../auth/platform.guard.js';

vi.mock('../../../constants', () => ({
  getRequiredAdminRoleId: vi.fn(() => 'admin-role-id'),
  getRequiredOwnerRoleId: vi.fn(() => 'owner-role-id'),
  getRequiredSystemTenantId: vi.fn(
    () => '00000000-0000-0000-0000-000000000000',
  ),
  getRequiredMemberRoleId: vi.fn(() => 'member-role-id'),
}));

describe('SystemAdminController', () => {
  let controller: SystemAdminController;

  const mockAuthProvider = {
    getSessionFromHeaders: vi.fn(),
    createInvitation: vi.fn(),
  };

  const mockUserProvider = {
    findById: vi.fn(),
    findByEmail: vi.fn(),
    findAll: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    deleteIfNotLastAdmin: vi.fn(),
    count: vi.fn(),
  };

  const mockTenantProvider = {
    findById: vi.fn(),
    findBySlug: vi.fn(),
    findAll: vi.fn(),
    createTenant: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  };

  const mockRoleProvider = {
    findById: vi.fn(),
    findByName: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [SystemAdminController],
      providers: [
        { provide: AUTH_PROVIDER, useValue: mockAuthProvider },
        { provide: USER_REPOSITORY, useValue: mockUserProvider },
        { provide: TENANT_REPOSITORY, useValue: mockTenantProvider },
        { provide: ROLE_REPOSITORY, useValue: mockRoleProvider },
      ],
    })
      .overrideGuard(SystemAdminGuard)
      .useValue({ canActivate: vi.fn(() => true) })
      .overrideGuard(PlatformGuard)
      .useValue({ canActivate: vi.fn(() => true) })
      .overrideGuard(AuthGuard)
      .useValue({ canActivate: vi.fn(() => true) })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: vi.fn(() => true) })
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
        tenantId: '00000000-0000-0000-0000-000000000000',
      });
    });

    it('should use default pagination parameters', async () => {
      mockUserProvider.findAll.mockResolvedValue({ data: [], total: 0 });

      await controller.listUsers(); // Defaults

      expect(mockUserProvider.findAll).toHaveBeenCalledWith({
        page: 1,
        limit: 10,
        tenantId: '00000000-0000-0000-0000-000000000000',
      });
    });
  });

  describe('createSystemInvitation', () => {
    it('should create system invitation', async () => {
      const mockInvitation = { id: 'inent1', email: 'test@example.com' };
      mockAuthProvider.createInvitation.mockResolvedValue(mockInvitation);
      mockRoleProvider.findById.mockResolvedValue({ id: 'owner-role-id' });

      const mockCtx: RequestAuthContext = {
        headers: new Headers(),
        user: { id: 'admin1' } as RequestAuthContext['user'],
        session: {
          id: 'sess-1',
          token: 'tok-1',
        } as RequestAuthContext['session'],
      };

      const result = await controller.createSystemInvitation(
        { email: 'test@example.com', role: getRequiredOwnerRoleId() },
        mockCtx,
      );

      expect(result).toEqual(mockInvitation);
      expect(mockAuthProvider.createInvitation).toHaveBeenCalledWith({
        email: 'test@example.com',
        role: getRequiredOwnerRoleId(),
        organizationId: getRequiredSystemTenantId(),
        inviterId: 'admin1',
        headers: mockCtx.headers,
      });
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
          role: 'member',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should create user via provider', async () => {
      mockUserProvider.findByEmail.mockResolvedValue(null);
      mockRoleProvider.findById.mockResolvedValue({
        id: 'member',
        name: 'Member',
      });
      const mockUser = {
        id: 'u1',
        email: 'new@example.com',
      };
      mockUserProvider.create.mockResolvedValue(mockUser);

      const result = await controller.createUser({
        name: 'Test',
        email: 'new@example.com',
        role: 'member',
      });

      expect(result).toEqual(mockUser);
      expect(mockRoleProvider.findById).toHaveBeenCalledWith('member');
      expect(mockUserProvider.create).toHaveBeenCalledWith({
        name: 'Test',
        email: 'new@example.com',
        role: 'member',
      });
      expect(mockUserProvider.update).not.toHaveBeenCalled();
    });
  });

  describe('updateTenant', () => {
    it('should throw NotFoundException if tenant not found', async () => {
      mockTenantProvider.findById.mockResolvedValue(null);

      await expect(
        controller.updateTenant('missing', { name: 'New Name' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException if slug is already taken', async () => {
      mockTenantProvider.findById.mockResolvedValue({
        id: 't1',
        slug: 'old-slug',
      });
      mockTenantProvider.findBySlug.mockResolvedValue({ id: 'other' });

      await expect(
        controller.updateTenant('t1', { slug: 'taken' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if no fields to update', async () => {
      mockTenantProvider.findById.mockResolvedValue({ id: 't1' });

      await expect(controller.updateTenant('t1', {})).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should update tenant', async () => {
      mockTenantProvider.findById.mockResolvedValue({
        id: 't1',
        slug: 'old-slug',
      });
      mockTenantProvider.findBySlug.mockResolvedValue(null); // Slug available
      const updated = { id: 't1', name: 'New Name' };
      mockTenantProvider.update.mockResolvedValue(updated);

      const result = await controller.updateTenant('t1', { name: 'New Name' });

      expect(result).toEqual(updated);
      expect(mockTenantProvider.update).toHaveBeenCalledWith('t1', {
        name: 'New Name',
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

    it('should delete tenant', async () => {
      mockTenantProvider.findById.mockResolvedValue({ id: 't1' });

      const result = await controller.deleteTenant('t1');

      expect(result).toEqual({ success: true });
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

    it('should throw BadRequestException if email taken', async () => {
      mockUserProvider.findById.mockResolvedValue({
        id: 'u1',
        email: 'old@example.com',
      });
      mockUserProvider.findByEmail.mockResolvedValue({ id: 'other' });

      await expect(
        controller.updateUser('u1', { email: 'taken@example.com' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should update user', async () => {
      mockUserProvider.findById.mockResolvedValue({
        id: 'u1',
        email: 'old@example.com',
      });
      mockUserProvider.findByEmail.mockResolvedValue(null);
      const updated = { id: 'u1', name: 'New' };
      mockUserProvider.update.mockResolvedValue(updated);

      const result = await controller.updateUser('u1', { name: 'New' });

      expect(result).toEqual(updated);
      expect(mockUserProvider.update).toHaveBeenCalledWith('u1', {
        name: 'New',
      });
    });
    it('should throw BadRequestException if no fields to update', async () => {
      mockUserProvider.findById.mockResolvedValue({ id: 'u1' });
      await expect(controller.updateUser('u1', {})).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('getUser', () => {
    it('should throw NotFoundException if user not found', async () => {
      mockUserProvider.findById.mockResolvedValue(null);
      await expect(controller.getUser('missing')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should return user', async () => {
      const user = { id: 'u1' };
      mockUserProvider.findById.mockResolvedValue(user);

      const result = await controller.getUser('u1');
      expect(result).toEqual(user);
    });
  });

  describe('deleteUser', () => {
    it('should throw NotFoundException if user not found', async () => {
      mockUserProvider.findById.mockResolvedValue(null);

      await expect(controller.deleteUser('missing')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw BadRequestException if user is the last admin', async () => {
      mockUserProvider.findById.mockResolvedValue({
        id: 'u1',
      });
      mockUserProvider.deleteIfNotLastAdmin.mockResolvedValue({
        success: false,
      });

      await expect(controller.deleteUser('u1')).rejects.toThrow(
        BadRequestException,
      );
      expect(mockUserProvider.deleteIfNotLastAdmin).toHaveBeenCalledWith(
        'u1',
        getRequiredSystemTenantId(),
      );
    });

    it('should delete user', async () => {
      mockUserProvider.findById.mockResolvedValue({
        id: 'u1',
      });
      mockUserProvider.deleteIfNotLastAdmin.mockResolvedValue({
        success: true,
      });

      await controller.deleteUser('u1');

      expect(mockUserProvider.deleteIfNotLastAdmin).toHaveBeenCalledWith(
        'u1',
        getRequiredSystemTenantId(),
      );
    });
  });

  describe('inviteUser', () => {
    const mockCtx: RequestAuthContext = {
      headers: new Headers(),
      user: { id: 'admin1' } as RequestAuthContext['user'],
      session: {
        id: 'sess-1',
        token: 'tok-1',
      } as RequestAuthContext['session'],
    };

    it('should throw NotFoundException if user not found', async () => {
      mockUserProvider.findById.mockResolvedValue(null);

      await expect(controller.inviteUser('missing', mockCtx)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should create system invite', async () => {
      mockUserProvider.findById.mockResolvedValue({
        id: 'u1',
        email: 'test@example.com',
      });

      await controller.inviteUser('u1', mockCtx);

      expect(mockAuthProvider.createInvitation).toHaveBeenCalledWith({
        email: 'test@example.com',
        role: getRequiredAdminRoleId(),
        organizationId: getRequiredSystemTenantId(), // System invite
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

    it('should use default pagination', async () => {
      mockTenantProvider.findAll.mockResolvedValue({ data: [], total: 0 });

      await controller.listTenants();

      expect(mockTenantProvider.findAll).toHaveBeenCalledWith({
        page: 1,
        limit: 10,
      });
    });
  });

  describe('getTenant', () => {
    it('should throw NotFoundException if tenant not found', async () => {
      mockTenantProvider.findById.mockResolvedValue(null);
      await expect(controller.getTenant('missing')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should return tenant', async () => {
      const tenant = { id: 't1', name: 'Test Tenant' };
      mockTenantProvider.findById.mockResolvedValue(tenant);

      const result = await controller.getTenant('t1');
      expect(result).toEqual(tenant);
    });
  });
});
