/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */

import { SystemAdminController } from './system-admin.controller';

import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { BadRequestException, NotFoundException } from '@nestjs/common';

// Define mock as ANY to allow jest methods (mockReturnValue, etc)
// We only cast to NodePgDatabase when injecting into the controller.
const mockDb: any = {
  query: {
    user: {
      findMany: jest.fn(),
    },
    organization: {
      findMany: jest.fn(),
    },
  },
  select: jest.fn(),
  from: jest.fn(),
};

// Chain mocks
mockDb.select.mockReturnThis();
mockDb.from.mockImplementation(() => Promise.resolve([{ count: 5 }]));

describe('SystemAdminController', () => {
  let controller: SystemAdminController;

  beforeEach(() => {
    jest.clearAllMocks();

    // Reset mocks with full structure
    mockDb.query = {
      user: {
        findMany: jest.fn(),
      },
      organization: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
      },
    };

    mockDb.select = jest.fn().mockReturnThis();
    mockDb.from = jest
      .fn()
      .mockImplementation(() => Promise.resolve([{ count: 5 }]));
    mockDb.insert = jest.fn();
    mockDb.update = jest.fn();
    mockDb.delete = jest.fn();

    // Define internal chain logic
    mockDb.limit = jest.fn().mockReturnThis();
    mockDb.offset = jest.fn().mockReturnThis();
    mockDb.orderBy = jest.fn().mockReturnThis();
    mockDb.groupBy = jest.fn().mockReturnThis();
    mockDb.leftJoin = jest.fn().mockReturnThis();
    mockDb.set = jest.fn().mockReturnThis();
    mockDb.where = jest.fn().mockReturnThis();
    mockDb.values = jest.fn().mockReturnThis();
    mockDb.returning = jest.fn();

    // Chain wiring
    mockDb.insert.mockReturnValue(mockDb);
    mockDb.update.mockReturnValue(mockDb);
    mockDb.delete.mockReturnValue(mockDb);
    mockDb.values.mockReturnValue(mockDb);
    mockDb.set.mockReturnValue(mockDb);
    mockDb.where.mockReturnValue(mockDb);

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
    it('should return paginated tenants with aggregated user count', async () => {
      // Mock db.select chain for tenants
      const mockResult = [{ id: 't1', name: 'Tenant 1', userCount: 2 }];

      // We need to support two different select calls:
      // 1. Tenants data (returns promise with array)
      // 2. Count (returns promise with [{count: X}])
      // Since select returns a chainable builder, we mock the final execution.
      // However, `mockDb.select` is a global mock here.
      // Easier way: mock implementation to inspect call args or return sequence.

      mockDb.limit = jest.fn().mockReturnThis();
      mockDb.offset = jest.fn().mockReturnThis();
      mockDb.orderBy = jest.fn().mockReturnThis();
      mockDb.groupBy = jest.fn().mockReturnThis();
      mockDb.leftJoin = jest.fn().mockReturnThis();
      /* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return */
      mockDb.from = jest.fn().mockReturnValue({
        leftJoin: mockDb.leftJoin, // Chain continuation
        limit: mockDb.limit,
        offset: mockDb.offset,
        groupBy: mockDb.groupBy,
        orderBy: mockDb.orderBy,
        then: (resolve: any) => resolve(mockResult), // Final await
      });
      /* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return */
      // The second call for total count also calls .from()
      // This is complex to mock cleanly with a shared `mockDb` object without conditional logic.
      // Let's rely on `mockReturnValueOnce`?

      // Call 1: Data
      /* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return */
      mockDb.from.mockReturnValueOnce({
        leftJoin: mockDb.leftJoin,
        groupBy: mockDb.groupBy,
        limit: mockDb.limit,
        offset: mockDb.offset,
        orderBy: mockDb.orderBy,
        then: (resolve: any) => resolve(mockResult),
      });
      /* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return */

      // Call 2: Total Count
      mockDb.from.mockReturnValueOnce(Promise.resolve([{ count: 5 }]));

      const result = await controller.listTenants('1', '10');

      expect(result).toEqual({
        data: [{ id: 't1', name: 'Tenant 1', userCount: 2 }],
        total: 5,
      });
    });
    it('should clamp pagination parameters', async () => {
      /* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return */
      mockDb.from.mockReturnValueOnce({
        leftJoin: mockDb.leftJoin,
        groupBy: mockDb.groupBy,
        limit: mockDb.limit,
        offset: mockDb.offset,
        orderBy: mockDb.orderBy,
        then: (resolve: any) => resolve([]),
      });
      /* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return */
      mockDb.from.mockReturnValueOnce(Promise.resolve([{ count: 0 }]));

      // Request 1000 items (should clamp to 100)
      await controller.listTenants('1', '1000');

      expect(mockDb.limit).toHaveBeenCalledWith(100);
      expect(mockDb.offset).toHaveBeenCalledWith(0);
    });

    it('should handle invalid/negative pagination inputs', async () => {
      /* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return */
      mockDb.from.mockReturnValueOnce({
        leftJoin: mockDb.leftJoin,
        groupBy: mockDb.groupBy,
        limit: mockDb.limit,
        offset: mockDb.offset,
        orderBy: mockDb.orderBy,
        then: (resolve: any) => resolve([]),
      });
      /* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return */
      mockDb.from.mockReturnValueOnce(Promise.resolve([{ count: 0 }]));

      // Request invalid strings
      await controller.listTenants('invalid', '-5');

      expect(mockDb.limit).toHaveBeenCalledWith(1); // Clamps to 1
      expect(mockDb.offset).toHaveBeenCalledWith(0); // Default page 1 -> 0
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
  });

  describe('deleteTenant', () => {
    it('should throw NotFoundException if tenant not found', async () => {
      mockDb.query.organization.findFirst.mockResolvedValue(null);

      await expect(controller.deleteTenant('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
