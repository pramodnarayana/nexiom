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

  // ... (previous tests match until updateTenant)

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
