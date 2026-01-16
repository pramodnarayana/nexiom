/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */

import { SystemAdminController } from './system-admin.controller';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';

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

    // Reset mocks
    mockDb.select.mockReturnThis();
    mockDb.from.mockImplementation(() => Promise.resolve([{ count: 5 }]));

    // Pure Unit Test
    // Cast here to satisfy dependency injection signature
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
    it('should return tenants with user count', async () => {
      const mockTenants = [
        { id: 't1', name: 'Tenant 1', members: [{}, {}] }, // 2 members
      ];
      mockDb.query.organization.findMany.mockResolvedValue(mockTenants);

      const result = await controller.listTenants();

      expect(result).toEqual({
        data: [{ ...mockTenants[0], userCount: 2 }],
        total: 1,
      });
    });
  });
});
