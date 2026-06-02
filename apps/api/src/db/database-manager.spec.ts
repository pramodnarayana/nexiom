/* eslint-disable @typescript-eslint/unbound-method */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as path from 'node:path';
import { DatabaseManager } from './database-manager.js';
import { execSync } from 'node:child_process';

// Hoisted mocks for dynamic imports
const { drizzleMocks, rbacMocks, constantMocks, fsMocks, dbManagerMocks } =
  vi.hoisted(() => ({
    drizzleMocks: {
      select: vi.fn(),
      update: vi.fn(),
      insert: vi.fn(),
      transaction: vi.fn(),
      query: {
        organization: {
          findFirst: vi.fn(),
        },
        user: {
          findFirst: vi.fn(),
        },
        role: {
          findFirst: vi.fn(),
        },
        member: {
          findMany: vi.fn(),
        },
        rolePermission: {
          findMany: vi.fn(),
        },
      },
    },
    rbacMocks: {
      seedSystemRbac: vi.fn(),
    },
    constantMocks: {
      getRequiredOwnerRoleId: vi.fn(() => 'owner-role'),
      getRequiredAdminRoleId: vi.fn(() => 'admin-role'),
      getRequiredMemberRoleId: vi.fn(() => 'member-role'),
      getRequiredSystemTenantId: vi.fn(() => 'system-tenant'),
    },
    fsMocks: {
      readdir: vi.fn().mockResolvedValue(['dummy-piece']),
      stat: vi.fn().mockResolvedValue({ isDirectory: () => true }),
      readFile: vi.fn().mockResolvedValue('{"name": "@test/piece-dummy"}'),
    },
    dbManagerMocks: {
      applyPlan: vi.fn().mockResolvedValue(undefined),
      migrateToOutboundActive: vi.fn().mockResolvedValue(undefined),
    },
  }));

// Mock dependencies
vi.mock('node:child_process');
vi.mock('pg', () => {
  const mClient = {
    connect: vi.fn(),
    query: vi.fn().mockResolvedValue({ rows: [] }),
    end: vi.fn(),
  };
  return {
    Client: vi.fn(() => mClient),
    Pool: vi.fn(() => mClient),
  };
});

vi.mock('drizzle-orm/node-postgres', () => ({
  drizzle: vi.fn(() => ({
    select: drizzleMocks.select,
    update: drizzleMocks.update,
    insert: drizzleMocks.insert,
    transaction: drizzleMocks.transaction,
    query: drizzleMocks.query,
  })),
}));

vi.mock('@nexiom/identity/utils/rbac-seeding', () => ({
  seedSystemRbac: rbacMocks.seedSystemRbac,
}));

vi.mock('../constants.js', () => constantMocks);

vi.mock('node:fs/promises', () => fsMocks);

vi.mock('@nexiom/dbmanager', () => ({
  TenantDatabaseManager: vi.fn(() => ({
    applyPlan: dbManagerMocks.applyPlan,
    migrateToOutboundActive: dbManagerMocks.migrateToOutboundActive,
  })),
  SchemaPlan: {
    NAMESPACE_ONLY: 'NAMESPACE_ONLY',
    GATEWAY_ACTIVE: 'GATEWAY_ACTIVE',
    OUTBOUND_ACTIVE: 'OUTBOUND_ACTIVE',
  },
}));

describe('DatabaseManager', () => {
  let manager: DatabaseManager;
  const originalEnv = process.env.NODE_ENV;

  beforeEach(() => {
    vi.clearAllMocks();

    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test';
    manager = new DatabaseManager();

    // Default mock behaviors — mirror production Drizzle:
    // values() returns a real Promise so await/catch/finally all work correctly.
    // The resolved chain also exposes onConflictDoNothing/DoUpdate/returning for
    // callers that chain further methods after await.
    const makeInsertChain = () => ({
      values: vi.fn().mockImplementation(() => {
        const chain = {
          onConflictDoNothing: vi.fn().mockResolvedValue(undefined),
          onConflictDoUpdate: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ id: 'mock-id' }]),
          }),
          returning: vi.fn().mockResolvedValue([{ id: 'mock-id' }]),
        };
        // values() is synchronously chainable (supports .returning(...) before await)
        // but when the caller does `await values()` the resolved value is a plain
        // execution result, NOT the builder chain — matching real Drizzle behaviour.
        const executionResult = [{ id: 'mock-id' }];
        const promise = Promise.resolve(executionResult) as Promise<
          typeof executionResult
        > &
          typeof chain;
        return Object.assign(promise, chain);
      }),
    });
    drizzleMocks.insert.mockImplementation(makeInsertChain);

    const makeUpdateChain = () => {
      const chain = {
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(undefined),
        }),
      };
      return chain;
    };
    drizzleMocks.update.mockImplementation(makeUpdateChain);

    const makeSelectChain = () => {
      const limitMock = vi.fn().mockResolvedValue([]);
      const chain = {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: limitMock,
          }),
          limit: limitMock,
        }),
      };
      return chain;
    };
    drizzleMocks.select.mockImplementation(makeSelectChain);

    drizzleMocks.transaction.mockImplementation(
      async (cb: (tx: typeof drizzleMocks) => Promise<unknown>) =>
        cb(drizzleMocks),
    );
    drizzleMocks.query.organization.findFirst.mockResolvedValue(null);
  });

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  describe('Environment Safety', () => {
    it('should allow operations in test environment', async () => {
      process.env.NODE_ENV = 'test';
      await expect(manager.dropAll()).resolves.not.toThrow();
    });

    it('should allow operations in development environment', async () => {
      process.env.NODE_ENV = 'development';
      await expect(new DatabaseManager().dropAll()).resolves.not.toThrow();
    });

    it('should block destructive operations in production', async () => {
      process.env.NODE_ENV = 'production';
      const prodManager = new DatabaseManager();

      await expect(prodManager.dropAll()).rejects.toThrow(
        'Destructive database operations only allowed',
      );
    });

    it('should block destructive operations in staging', async () => {
      process.env.NODE_ENV = 'staging';
      const stagingManager = new DatabaseManager();

      await expect(stagingManager.fresh()).rejects.toThrow(
        'Destructive database operations only allowed in',
      );
      await expect(stagingManager.dropAll()).rejects.toThrow(
        'Destructive database operations only allowed in',
      );
      await expect(stagingManager.truncateAll()).rejects.toThrow(
        'Destructive database operations only allowed in',
      );
      await expect(stagingManager.reset()).rejects.toThrow(
        'Destructive database operations only allowed in',
      );
    });
  });

  describe('dropAll()', () => {
    it('should execute drop and create schema queries', async () => {
      await manager.dropAll();

      const { Client } = await import('pg');
      const clientInstance = new Client();

      expect(clientInstance.connect).toHaveBeenCalled();
      expect(clientInstance.query).toHaveBeenCalledWith(
        expect.stringContaining('DROP SCHEMA IF EXISTS drizzle CASCADE'),
      );
      expect(clientInstance.query).toHaveBeenCalledWith(
        expect.stringContaining('DROP SCHEMA IF EXISTS public CASCADE'),
      );
      expect(clientInstance.query).toHaveBeenCalledWith(
        expect.stringContaining('CREATE SCHEMA public'),
      );
      expect(clientInstance.end).toHaveBeenCalled();
    });

    it('should throw error if query fails', async () => {
      const { Client } = await import('pg');
      const clientInstance = new Client();
      vi.mocked(clientInstance.query).mockRejectedValueOnce(
        new Error('Connection failed'),
      );

      await expect(manager.dropAll()).rejects.toThrow('Failed to drop schemas');
    });
  });

  describe('migrate()', () => {
    it('should run root pnpm db:migrate script via execSync', () => {
      manager.migrate();

      const expectedCwd = path.resolve(__dirname, '../../../..');

      expect(execSync).toHaveBeenCalledWith(
        'pnpm db:migrate',
        expect.objectContaining({
          stdio: 'inherit',
          cwd: expectedCwd,
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          env: expect.objectContaining({ FORCE_COLOR: '1' }),
        }),
      );
    });
  });

  describe('truncateAll()', () => {
    it('should truncate all tables found in schema', async () => {
      const { Client } = await import('pg');
      const clientInstance = new Client();

      // Mock SELECT query response
      vi.mocked(clientInstance.query).mockImplementation(
        // eslint-disable-next-line @typescript-eslint/require-await, @typescript-eslint/no-misused-promises
        async (sql: unknown) => {
          if (
            typeof sql === 'string' &&
            sql.includes('information_schema.tables')
          ) {
            return {
              rows: [{ table_name: 'user' }, { table_name: 'session' }],
            };
          }
          return { rows: [] };
        },
      );

      await manager.truncateAll();

      // Verify TRUNCATE call was made with found tables
      expect(clientInstance.query).toHaveBeenCalledWith(
        expect.stringMatching(/TRUNCATE TABLE "user", "session" CASCADE;/),
      );
    });
  });

  describe('seed()', () => {
    it('should seed database with system org and rbac', async () => {
      await manager.seed();

      // Verify db connection
      const { Client } = await import('pg');
      expect(Client).toHaveBeenCalled();

      // Verify system org creation
      expect(drizzleMocks.insert).toHaveBeenCalled();

      // Verify RBAC seeding
      expect(rbacMocks.seedSystemRbac).toHaveBeenCalled();

      // Verify pieces discovery check
      expect(fsMocks.readdir).toHaveBeenCalledWith(
        expect.stringContaining(path.join('packages', 'pieces', 'application')),
      );
      expect(fsMocks.readdir).toHaveBeenCalledWith(
        expect.stringContaining(path.join('packages', 'pieces', 'platform')),
      );
    });

    it('should skip creating system org if it exists', async () => {
      // Mock db to return existing org
      drizzleMocks.query.organization.findFirst.mockResolvedValueOnce({
        id: 'system-tenant',
      });

      await manager.seed();

      // Pieces seeding always runs (idempotent via onConflictDoNothing),
      // but the org insert should be skipped when org already exists.
      const { organization } = await import('./schema.js');
      const insertCalls = drizzleMocks.insert.mock.calls;
      const orgInserted = insertCalls.some(
        (args: unknown[]) => args[0] === organization,
      );
      expect(orgInserted).toBe(false);
      expect(rbacMocks.seedSystemRbac).toHaveBeenCalled();

      // Verify pieces discovery check
      expect(fsMocks.readdir).toHaveBeenCalledWith(
        expect.stringContaining(path.join('packages', 'pieces', 'application')),
      );
      expect(fsMocks.readdir).toHaveBeenCalledWith(
        expect.stringContaining(path.join('packages', 'pieces', 'platform')),
      );
    });
  });

  describe('seedAbac()', () => {
    it('should seed restricted_admin role and conditional permissions', async () => {
      const onConflictDoNothingMock = vi.fn().mockResolvedValue(undefined);
      const valuesMock = vi.fn().mockReturnValue({
        onConflictDoNothing: onConflictDoNothingMock,
      });

      // Capture arguments passed to insert()
      const insertSpy = drizzleMocks.insert.mockReturnValue({
        values: valuesMock,
      });

      // We need to import schema to compare against
      const { permission, role, rolePermission } = await import('./schema.js');

      await manager.seedAbac();

      // 1. Verify Permission Table Insert
      expect(insertSpy).toHaveBeenCalledWith(permission);
      expect(valuesMock).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ id: 'users:read' }),
          expect.objectContaining({ id: 'users:delete' }),
        ]),
      );

      // 2. Verify Role Table Insert
      expect(insertSpy).toHaveBeenCalledWith(role);
      expect(valuesMock).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'restricted_admin',
          name: 'Restricted Admin',
        }),
      );

      // 3. Verify RolePermission Table Insert
      expect(insertSpy).toHaveBeenCalledWith(rolePermission);
      // Verify Conditional Permission (rp_restricted_delete)
      expect(valuesMock).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'rp_restricted_delete',
          roleId: 'restricted_admin',
          permissionId: 'users:delete',
          conditions: {
            role: { $ne: 'owner' },
          },
        }),
      );
      // Verify unconditional permission grant (rp_restricted_read)
      expect(valuesMock).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'rp_restricted_read',
          roleId: 'restricted_admin',
          permissionId: 'users:read',
        }),
      );
      // Verify idempotent upserts
      expect(onConflictDoNothingMock).toHaveBeenCalledTimes(4);
    });
  });

  describe('Error Handling', () => {
    it('should throw if DATABASE_URL is missing', async () => {
      delete process.env.DATABASE_URL;
      await expect(manager.dropAll()).rejects.toThrow(
        'DATABASE_URL is not defined',
      );
    });

    it('should handle truncate errors gracefully and rethrow', async () => {
      const { Client } = await import('pg');
      const clientInstance = new Client();

      // Mock successful table discovery
      vi.mocked(clientInstance.query).mockImplementationOnce(
        // eslint-disable-next-line @typescript-eslint/require-await, @typescript-eslint/no-misused-promises
        async () => ({ rows: [{ table_name: 'test_table' }] }),
      );

      // Mock truncate failure
      vi.mocked(clientInstance.query).mockImplementationOnce(
        // eslint-disable-next-line @typescript-eslint/require-await, @typescript-eslint/no-misused-promises
        async () => {
          throw new Error('Truncate error');
        },
      );

      const logSpy = vi.spyOn(console, 'log');

      // Expect error to be rethrown after logging
      await expect(manager.truncateAll()).rejects.toThrow('Truncate error');

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('Truncate failed'),
      );
    });

    it('should handle empty tables list in truncateAll', async () => {
      const { Client } = await import('pg');
      const clientInstance = new Client();

      // Mock empty tables
      vi.mocked(clientInstance.query).mockImplementationOnce(
        // eslint-disable-next-line @typescript-eslint/require-await, @typescript-eslint/no-misused-promises
        async () => ({ rows: [] }),
      );

      const logSpy = vi.spyOn(console, 'log');
      await manager.truncateAll();

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('No tables found'),
      );
    });
  });

  describe('fresh()', () => {
    it('should call dropAll, migrate, and seed in order', async () => {
      const dropSpy = vi.spyOn(manager, 'dropAll').mockResolvedValue(undefined);
      const migrateSpy = vi
        .spyOn(manager, 'migrate')
        .mockImplementation(() => {});
      const seedSpy = vi.spyOn(manager, 'seed').mockResolvedValue(undefined);

      await manager.fresh();

      expect(dropSpy).toHaveBeenCalledTimes(1);
      expect(migrateSpy).toHaveBeenCalledTimes(1);
      expect(seedSpy).toHaveBeenCalledTimes(1);

      // Verify order
      expect(dropSpy.mock.invocationCallOrder[0]).toBeLessThan(
        migrateSpy.mock.invocationCallOrder[0],
      );
      expect(migrateSpy.mock.invocationCallOrder[0]).toBeLessThan(
        seedSpy.mock.invocationCallOrder[0],
      );
    });
  });

  describe('reset()', () => {
    it('should call truncateAll and seed in order', async () => {
      const truncateSpy = vi
        .spyOn(manager, 'truncateAll')
        .mockResolvedValue(undefined);
      const seedSpy = vi.spyOn(manager, 'seed').mockResolvedValue(undefined);

      await manager.reset();

      expect(truncateSpy).toHaveBeenCalledTimes(1);
      expect(seedSpy).toHaveBeenCalledTimes(1);

      expect(truncateSpy.mock.invocationCallOrder[0]).toBeLessThan(
        seedSpy.mock.invocationCallOrder[0],
      );
    });
  });
  describe('checkUserPermissions()', () => {
    it('should log error if user not found', async () => {
      const consoleSpy = vi.spyOn(console, 'error');
      drizzleMocks.query.user.findFirst.mockResolvedValue(null);

      await manager.checkUserPermissions('missing-id');

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("User 'missing-id' not found"),
      );
    });

    it('should list permissions from memberships', async () => {
      const logSpy = vi.spyOn(console, 'log');

      const mockUser = {
        id: 'u1',
        email: 'test@example.com',
        role: 'member',
        members: [
          {
            organizationId: 'org1',
            role: {
              id: 'role1',
              name: 'Admin',
              permissions: [{ permissionId: 'users:create' }],
            },
          },
        ],
      };

      drizzleMocks.query.user.findFirst.mockResolvedValue(mockUser);

      await manager.checkUserPermissions('u1');

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('Found User: test@example.com'),
      );
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('Role: Admin (role1)'),
      );
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('users:create'),
      );
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('✅ users:create'),
      );
    });

    it('should handle legacy string roles in membership with zero effective permissions', async () => {
      const logSpy = vi.spyOn(console, 'log');

      // Mock user with legacy string role in member
      const mockUser = {
        id: 'u2',
        email: 'legacy@example.com',
        role: 'admin',
        members: [{ organizationId: 'org2', role: 'legacy-role-id' }],
        // logic in manager handles string roles by printing them but typically expects object for permission extraction unless resolved
        // Actually current implementation ONLY extracts permissions if role is object and has permissions array.
        // It does NOT perform extra query for permissions in checkUserPermissions (unlike BetterAuthAdapter).
        // It just prints the role ID.
      };

      drizzleMocks.query.user.findFirst.mockResolvedValue(mockUser);

      await manager.checkUserPermissions('u2');

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('Role: legacy-role-id (legacy-role-id)'),
      );
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('Effective Permissions (0)'),
      );
    });
  });

  describe('debugPermissions()', () => {
    it('should log error if role not found', async () => {
      const consoleSpy = vi.spyOn(console, 'error');
      drizzleMocks.query.role.findFirst.mockResolvedValue(null);

      await manager.debugPermissions('missing-role');

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Role 'missing-role' not found"),
      );
    });

    it('should list permissions and check critical ones', async () => {
      const logSpy = vi.spyOn(console, 'log');

      const mockRole = { id: 'r1', name: 'Admin' };
      const mockPerms = [{ permissionId: 'users:create' }];

      drizzleMocks.query.role.findFirst.mockResolvedValue(mockRole);
      drizzleMocks.query.rolePermission.findMany.mockResolvedValue(mockPerms);

      await manager.debugPermissions('Admin');

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('Found Role: Admin (r1)'),
      );
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('Permissions (1):'),
      );
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('    - users:create'),
      );
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('✅ users:create'),
      );
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('❌ system_users:create'),
      );
    });
  });

  describe('provisionLocal()', () => {
    it('should clean up globalClient in finally block even on error', async () => {
      process.env.ENCRYPTION_KEY = '00000000000000000000000000000000';
      process.env.SYSTEM_TENANT_ID = '00000000-0000-0000-0000-000000000000';
      try {
        const mockClient = { end: vi.fn(), query: vi.fn() };
        vi.spyOn(
          manager as unknown as { getPgClient: () => Promise<unknown> },
          'getPgClient',
        ).mockResolvedValue(mockClient);
        vi.spyOn(
          manager as unknown as {
            createTenantDatabase: () => Promise<unknown>;
          },
          'createTenantDatabase',
        ).mockResolvedValue(undefined);

        drizzleMocks.select.mockImplementationOnce(() => {
          throw new Error('Test select error');
        });

        await expect(manager.provisionLocal()).rejects.toThrow(
          'Test select error',
        );
        expect(mockClient.end).toHaveBeenCalled();
      } finally {
        delete process.env.SYSTEM_TENANT_ID;
      }
    });
  });
});
