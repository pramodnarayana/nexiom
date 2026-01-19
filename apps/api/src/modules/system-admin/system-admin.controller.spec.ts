import { SystemAdminController } from './system-admin.controller';

import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { BadRequestException, NotFoundException } from '@nestjs/common';

interface MockDb {
  query: {
    user: { findMany: jest.Mock; findFirst: jest.Mock };
    organization: { findFirst: jest.Mock; findMany: jest.Mock };
    member: { findFirst: jest.Mock };
    invitation: { findFirst: jest.Mock };
  };
  select: jest.Mock;
  from: jest.Mock;
  insert: jest.Mock;
  update: jest.Mock;
  delete: jest.Mock;
  transaction: jest.Mock;
  // Chain helpers
  limit: jest.Mock;
  offset: jest.Mock;
  orderBy: jest.Mock;
  groupBy: jest.Mock;
  leftJoin: jest.Mock;
  set: jest.Mock;
  where: jest.Mock;
  values: jest.Mock;
  returning: jest.Mock;
}

describe('SystemAdminController', () => {
  let controller: SystemAdminController;
  let mockDb: MockDb;

  beforeEach(() => {
    jest.clearAllMocks();

    // Reset mocks with full structure
    mockDb = {
      query: {
        user: { findMany: jest.fn(), findFirst: jest.fn() },
        organization: { findFirst: jest.fn(), findMany: jest.fn() },
        member: { findFirst: jest.fn() },
        invitation: { findFirst: jest.fn() },
      },
      select: jest.fn().mockReturnThis(),
      from: jest.fn().mockImplementation(() => Promise.resolve([{ count: 5 }])),
      insert: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call
      transaction: jest.fn((cb) => cb(mockDb)), // Mock transaction execution
      // Chain method definitions
      limit: jest.fn().mockReturnThis(),
      offset: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      leftJoin: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      values: jest.fn().mockReturnThis(),
      returning: jest.fn(),
    };

    controller = new SystemAdminController(
      mockDb as unknown as NodePgDatabase<typeof schema>,
    );
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('listUsers', () => {
    it('should return paginated users and total count', async () => {
      const mockUsers = [{ id: '1', name: 'User 1' }];
      mockDb.query.user.findMany.mockResolvedValue(mockUsers);

      const result = await controller.listUsers('1', '10');

      expect(result).toEqual({
        data: mockUsers,
        total: 5,
      });
      expect(mockDb.query.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 10, offset: 0 }),
      );
    });

    it('should handle invalid pagination params', async () => {
      mockDb.query.user.findMany.mockResolvedValue([]);

      await controller.listUsers('bad', 'bad');

      expect(mockDb.query.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 10, offset: 0 }),
      );
    });

    it('should use default pagination parameters', async () => {
      mockDb.query.user.findMany.mockResolvedValue([]);

      // Testing default params
      await controller.listUsers(undefined, undefined);

      expect(mockDb.query.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 10, offset: 0 }),
      );
    });
  });

  describe('listTenants', () => {
    // Define strict interface for our chainable builder
    interface MockQueryBuilder {
      leftJoin: jest.Mock;
      groupBy: jest.Mock;
      limit: jest.Mock;
      offset: jest.Mock;
      orderBy: jest.Mock;
      execute: () => Promise<unknown>;
    }

    const createMockBuilder = (result: unknown): MockQueryBuilder => ({
      leftJoin: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      offset: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue(result),
    });

    it('should return paginated tenants with aggregated user count', async () => {
      // Mock db.select chain for tenants
      const mockResult = [{ id: 't1', name: 'Tenant 1', userCount: 2 }];

      // Call 1: Data
      const mockQueryBuilder = createMockBuilder(mockResult);
      mockDb.from.mockReturnValueOnce(mockQueryBuilder);

      // Call 2: Total Count
      mockDb.from.mockReturnValueOnce(Promise.resolve([{ count: 5 }]));

      const result = await controller.listTenants('1', '10');

      expect(result).toEqual({
        data: [{ id: 't1', name: 'Tenant 1', userCount: 2 }],
        total: 5,
      });

      // Verify specific builder usage
      expect(mockQueryBuilder.limit).toHaveBeenCalledWith(10);
      expect(mockQueryBuilder.offset).toHaveBeenCalledWith(0);
      expect(mockQueryBuilder.execute).toHaveBeenCalled();
    });

    it('should clamp pagination parameters', async () => {
      const mockBuilder = createMockBuilder([]);

      mockDb.from.mockReturnValueOnce(mockBuilder);
      mockDb.from.mockReturnValueOnce(Promise.resolve([{ count: 0 }]));

      // Request 1000 items (should clamp to 100)
      await controller.listTenants('1', '1000');

      expect(mockBuilder.limit).toHaveBeenCalledWith(100);
      expect(mockBuilder.offset).toHaveBeenCalledWith(0);
      expect(mockBuilder.execute).toHaveBeenCalled();
    });

    it('should use default pagination parameters', async () => {
      const mockBuilder = createMockBuilder([]);
      mockDb.from.mockReturnValueOnce(mockBuilder);
      mockDb.from.mockReturnValueOnce(Promise.resolve([{ count: 0 }]));

      // Testing default params
      await controller.listTenants(undefined, undefined);

      expect(mockBuilder.limit).toHaveBeenCalledWith(10);
      expect(mockBuilder.offset).toHaveBeenCalledWith(0);
      expect(mockBuilder.execute).toHaveBeenCalled();
    });
  });

  describe('getTenant', () => {
    const createMockBuilder = (result: unknown) => ({
      leftJoin: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      offset: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(), // Added where
      execute: jest.fn().mockResolvedValue(result),
    });

    it('should return a single tenant', async () => {
      const mockResult = [{ id: 't1', name: 'Tenant 1' }];
      const mockQueryBuilder = createMockBuilder(mockResult);

      // Mock select().from() chain
      const mockSelect = {
        from: jest.fn().mockReturnValue(mockQueryBuilder),
      };
      mockDb.select.mockReturnValueOnce(mockSelect);

      const result = await controller.getTenant('t1');

      expect(result).toEqual(mockResult[0]);
      expect(mockSelect.from).toHaveBeenCalledWith(schema.organization);
      expect(mockQueryBuilder.where).toHaveBeenCalled();
      expect(mockQueryBuilder.execute).toHaveBeenCalled();
    });

    it('should throw NotFoundException if tenant not found', async () => {
      const mockQueryBuilder = createMockBuilder([]);
      const mockSelect = {
        from: jest.fn().mockReturnValue(mockQueryBuilder),
      };
      mockDb.select.mockReturnValueOnce(mockSelect);

      await expect(controller.getTenant('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('createTenant', () => {
    it('should throw BadRequestException if slug exists', async () => {
      mockDb.query.organization.findFirst.mockResolvedValue({ id: 'existing' });

      await expect(
        controller.createTenant({
          name: 'Test',
          slug: 'test',
          logo: '',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should create tenant if slug is unique', async () => {
      mockDb.query.organization.findFirst.mockResolvedValue(null);
      mockDb.insert = jest.fn().mockReturnValue({
        values: jest.fn().mockReturnValue({
          returning: jest.fn().mockResolvedValue([{ id: 'new', slug: 'test' }]),
        }),
      });

      const result = await controller.createTenant({
        name: 'Test',
        slug: 'test',
        logo: '',
      });

      expect(result).toEqual({ id: 'new', slug: 'test' });
    });
  });

  describe('createUser', () => {
    it('should throw BadRequestException if email exists', async () => {
      mockDb.query.user.findFirst.mockResolvedValue({ id: 'existing' });

      await expect(
        controller.createUser({
          name: 'Test',
          email: 'test@example.com',
          systemRole: 'user',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should create user if email is unique', async () => {
      mockDb.query.user.findFirst.mockResolvedValue(null);
      mockDb.insert = jest.fn().mockReturnValue({
        values: jest.fn().mockReturnValue({
          returning: jest.fn().mockResolvedValue([
            {
              id: 'new',
              email: 'test@example.com',
              name: 'Test',
              systemRole: 'user',
            },
          ]),
        }),
      });

      const result = await controller.createUser({
        name: 'Test',
        email: 'test@example.com',
        systemRole: 'user',
      });

      expect(result).toEqual({
        id: 'new',
        email: 'test@example.com',
        name: 'Test',
        systemRole: 'user',
      });
      expect(mockDb.insert).toHaveBeenCalledWith(schema.user);
    });
  });

  describe('updateTenant', () => {
    it('should throw NotFoundException if tenant not found', async () => {
      mockDb.query.organization.findFirst.mockResolvedValue(null);

      await expect(
        controller.updateTenant('missing', { name: 'New' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException if new slug overlaps', async () => {
      mockDb.query.organization.findFirst
        .mockResolvedValueOnce({ id: 't1', slug: 'old' }) // Existing target
        .mockResolvedValueOnce({ id: 't2', slug: 'taken' }); // Collision check

      await expect(
        controller.updateTenant('t1', { slug: 'taken' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if payload is empty', async () => {
      mockDb.query.organization.findFirst.mockResolvedValue({ id: 't1' });
      // Valid tenant, but empty update
      await expect(controller.updateTenant('t1', {})).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should update tenant successfully', async () => {
      // 1. Find existing
      mockDb.query.organization.findFirst
        .mockResolvedValueOnce({ id: 't1', slug: 'old' }) // Existing
        .mockResolvedValueOnce(null); // Collision check (slug change)

      // 2. Update
      mockDb.update = jest.fn().mockReturnValue({
        set: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            returning: jest
              .fn()
              .mockResolvedValue([{ id: 't1', slug: 'new-slug', name: 'New' }]),
          }),
        }),
      });

      const result = await controller.updateTenant('t1', {
        name: 'New',
        slug: 'new-slug',
      });

      expect(result).toEqual({ id: 't1', slug: 'new-slug', name: 'New' });
      // Verify update called with correct args
      expect(mockDb.update).toHaveBeenCalled();
    });

    it('should update specific fields (status only)', async () => {
      mockDb.query.organization.findFirst.mockResolvedValue({ id: 't1' });

      const mockReturning = jest
        .fn()
        .mockResolvedValue([{ id: 't1', status: 'suspended' }]);
      const mockSet = jest.fn().mockReturnValue({
        where: jest.fn().mockReturnValue({ returning: mockReturning }),
      });
      mockDb.update = jest.fn().mockReturnValue({ set: mockSet });

      await controller.updateTenant('t1', { status: 'suspended' });

      // Verify payload passed to set()
      expect(mockSet).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'suspended' }),
      );
    });

    it('should update all fields including metadata', async () => {
      mockDb.query.organization.findFirst
        .mockResolvedValueOnce({ id: 't1', slug: 'old' })
        .mockResolvedValueOnce(null);

      const mockSet = jest.fn().mockReturnValue({
        where: jest.fn().mockReturnValue({
          returning: jest.fn().mockResolvedValue([{ id: 't1' }]),
        }),
      });
      mockDb.update = jest.fn().mockReturnValue({ set: mockSet });

      const payload = {
        name: 'Full Update',
        slug: 'full-update',
        logo: 'logo.png',
        status: 'active' as const,
        metadata: { key: 'value' },
      };

      await controller.updateTenant('t1', payload);

      expect(mockSet).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Full Update',
          slug: 'full-update',
          logo: 'logo.png',
          status: 'active',
          metadata: JSON.stringify({ key: 'value' }),
        }),
      );
    });
  });

  describe('deleteTenant', () => {
    it('should throw NotFoundException if tenant not found', async () => {
      mockDb.query.organization.findFirst.mockResolvedValue(null);

      await expect(controller.deleteTenant('missing')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should delete tenant successfully inside transaction', async () => {
      // 1. Find existing
      mockDb.query.organization.findFirst.mockResolvedValue({ id: 't1' });

      // 2. Setup Deletes
      // We expect 3 deletes: member, invitation, organization
      // We'll mock the delete chain to return a 'where' mock
      const mockWhere = jest.fn().mockResolvedValue({});
      mockDb.delete = jest.fn().mockReturnValue({
        where: mockWhere,
      });

      await controller.deleteTenant('t1');

      expect(mockDb.transaction).toHaveBeenCalled();

      // Verify calls inside transaction
      // Since it's inside transaction, we check the calls on mockDb (because our mock transaction calls cb(mockDb))
      // Call 1: Member
      expect(mockDb.delete).toHaveBeenNthCalledWith(1, schema.member);
      // Call 2: Invitation
      expect(mockDb.delete).toHaveBeenNthCalledWith(2, schema.invitation);
      // Call 3: Organization
      expect(mockDb.delete).toHaveBeenNthCalledWith(3, schema.organization);

      // Verify 3 executions of 'where'
      expect(mockWhere).toHaveBeenCalledTimes(3);
    });
  });

  describe('updateUser', () => {
    it('should throw NotFoundException if user not found', async () => {
      mockDb.query.user.findFirst.mockResolvedValue(null);

      await expect(
        controller.updateUser('missing', { name: 'New' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException if payload is empty', async () => {
      mockDb.query.user.findFirst.mockResolvedValue({ id: 'u1' });

      await expect(controller.updateUser('u1', {})).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should update user successfully', async () => {
      mockDb.query.user.findFirst.mockResolvedValue({ id: 'u1' });

      mockDb.update = jest.fn().mockReturnValue({
        set: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            returning: jest
              .fn()
              .mockResolvedValue([
                { id: 'u1', name: 'New Name', systemRole: 'platform_admin' },
              ]),
          }),
        }),
      });

      const result = await controller.updateUser('u1', {
        name: 'New Name',
        systemRole: 'platform_admin',
      });

      expect(result).toEqual({
        id: 'u1',
        name: 'New Name',
        systemRole: 'platform_admin',
      });
      expect(mockDb.update).toHaveBeenCalledWith(schema.user);
    });

    it('should update user specific fields (emailVerified)', async () => {
      mockDb.query.user.findFirst.mockResolvedValue({ id: 'u1' });

      const mockSet = jest.fn().mockReturnValue({
        where: jest.fn().mockReturnValue({
          returning: jest.fn().mockResolvedValue([{ id: 'u1' }]),
        }),
      });
      mockDb.update = jest.fn().mockReturnValue({ set: mockSet });

      await controller.updateUser('u1', { emailVerified: true });

      expect(mockSet).toHaveBeenCalledWith(
        expect.objectContaining({ emailVerified: true }),
      );
    });

    it('should throw BadRequestException if email already taken (pre-check)', async () => {
      // 1. Return payload user first
      mockDb.query.user.findFirst
        .mockResolvedValueOnce({ id: 'u1', email: 'old@example.com' })
        // 2. Return collision user next
        .mockResolvedValueOnce({ id: 'u2', email: 'taken@example.com' });

      await expect(
        controller.updateUser('u1', { email: 'taken@example.com' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException on race condition (duplicate key)', async () => {
      // 1. Return payload user (user exists)
      mockDb.query.user.findFirst.mockResolvedValueOnce({
        id: 'u1',
        email: 'old@example.com',
      });

      // 2. Return null for uniqueness check (simulate pre-check pass)
      mockDb.query.user.findFirst.mockResolvedValueOnce(null);

      // 3. Mock db update to throw unique constraint error (race condition hit)
      mockDb.update = jest.fn().mockReturnValue({
        set: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            returning: jest
              .fn()
              .mockRejectedValue(
                new Error('duplicate key value violates unique constraint'),
              ),
          }),
        }),
      });

      await expect(
        controller.updateUser('u1', { email: 'race@example.com' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('getUser', () => {
    it('should return a single user', async () => {
      const mockUser = { id: 'u1', name: 'User 1' };
      mockDb.query.user.findFirst.mockResolvedValue(mockUser);

      const result = await controller.getUser('u1');

      expect(result).toEqual(mockUser);
      expect(mockDb.query.user.findFirst).toHaveBeenCalledWith(
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        expect.objectContaining({ where: expect.anything() }),
      );
    });

    it('should throw NotFoundException if user not found', async () => {
      mockDb.query.user.findFirst.mockResolvedValue(null);

      await expect(controller.getUser('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('deleteUser', () => {
    it('should throw NotFoundException if user not found', async () => {
      mockDb.query.user.findFirst.mockResolvedValue(null);

      await expect(controller.deleteUser('missing')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should delete user and dependencies transactionally', async () => {
      mockDb.query.user.findFirst.mockResolvedValue({
        id: 'u1',
        systemRole: 'user',
      }); // Normal user

      const mockWhere = jest.fn().mockResolvedValue({});

      mockDb.delete = jest.fn().mockReturnValue({
        where: mockWhere,
      });

      await controller.deleteUser('u1');

      expect(mockDb.transaction).toHaveBeenCalled();

      // Verify deletion order inside transaction
      // 1. Memberships
      expect(mockDb.delete).toHaveBeenNthCalledWith(1, schema.member);
      // 2. Invitations (Inviter)
      expect(mockDb.delete).toHaveBeenNthCalledWith(2, schema.invitation);
      // 3. Invitations (Recipient)
      expect(mockDb.delete).toHaveBeenNthCalledWith(3, schema.invitation);
      // 4. Sessions
      expect(mockDb.delete).toHaveBeenNthCalledWith(4, schema.session);
      // 5. Accounts
      expect(mockDb.delete).toHaveBeenNthCalledWith(5, schema.account);
      // 6. User
      expect(mockDb.delete).toHaveBeenNthCalledWith(6, schema.user);

      expect(mockWhere).toHaveBeenCalledTimes(6);
    });

    it('should prevent deleting the last platform admin', async () => {
      mockDb.query.user.findFirst.mockResolvedValue({
        id: 'admin1',
        systemRole: 'platform_admin',
      });

      // Mock db.select().from().where()
      const mockBuilder = {
        where: jest.fn().mockResolvedValue([{ count: 0 }]),
      };
      // mockDb.from returns the builder (because db.select() returns 'this', and 'this.from' is called)
      mockDb.from.mockReturnValueOnce(mockBuilder);

      await expect(controller.deleteUser('admin1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should allow deleting platform admin if others exist', async () => {
      mockDb.query.user.findFirst.mockResolvedValue({
        id: 'admin1',
        systemRole: 'platform_admin',
      });

      // Mock db.select().from().where()
      const mockBuilder = {
        where: jest.fn().mockResolvedValue([{ count: 1 }]),
      };
      mockDb.from.mockReturnValueOnce(mockBuilder);

      const mockWhere = jest.fn().mockResolvedValue({});
      mockDb.delete = jest.fn().mockReturnValue({ where: mockWhere });

      await controller.deleteUser('admin1');

      expect(mockDb.transaction).toHaveBeenCalled();
    });
  });
});
