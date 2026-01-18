import { SystemAdminController } from './system-admin.controller';

import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { BadRequestException, NotFoundException } from '@nestjs/common';

interface MockDb {
  query: {
    user: { findMany: jest.Mock };
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
        user: { findMany: jest.fn() },
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
  });

  describe('listTenants', () => {
    // Define strict interface for our chainable builder
    interface MockQueryBuilder {
      leftJoin: jest.Mock;
      groupBy: jest.Mock;
      limit: jest.Mock;
      offset: jest.Mock;
      orderBy: jest.Mock;
      then: (resolve: (arg: unknown) => void) => void;
    }

    const createMockBuilder = (result: unknown): MockQueryBuilder => ({
      leftJoin: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      offset: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      then: (resolve: (arg: unknown) => void) => resolve(result),
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
    });

    it('should clamp pagination parameters', async () => {
      const mockBuilder = createMockBuilder([]);

      mockDb.from.mockReturnValueOnce(mockBuilder);
      mockDb.from.mockReturnValueOnce(Promise.resolve([{ count: 0 }]));

      // Request 1000 items (should clamp to 100)
      await controller.listTenants('1', '1000');

      expect(mockBuilder.limit).toHaveBeenCalledWith(100);
      expect(mockBuilder.offset).toHaveBeenCalledWith(0);
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

      // 2. Check dependents (mock none for simple success path)
      // Note: In transaction, 'cb(mockDb)' is called, so mockDb methods are used
      mockDb.query.member = { findFirst: jest.fn().mockResolvedValue(null) };
      mockDb.query.invitation = {
        findFirst: jest.fn().mockResolvedValue(null),
      };

      // 3. Delete
      mockDb.delete = jest.fn().mockReturnValue({
        where: jest.fn().mockResolvedValue({}),
      });

      const result = await controller.deleteTenant('t1');

      expect(result).toEqual({ success: true });
      expect(mockDb.transaction).toHaveBeenCalled();
      expect(mockDb.delete).toHaveBeenCalled(); // Called inside transaction
    });
  });
});
