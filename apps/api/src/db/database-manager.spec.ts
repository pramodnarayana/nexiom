/* eslint-disable @typescript-eslint/unbound-method */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DatabaseManager } from './database-manager';
import { execSync } from 'node:child_process';

// Hoisted mocks for dynamic imports
const { drizzleMocks, rbacMocks, constantMocks } = vi.hoisted(() => ({
  drizzleMocks: {
    insert: vi.fn(),
    query: {
      organization: {
        findFirst: vi.fn(),
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
}));

// Mock dependencies
vi.mock('node:child_process');
vi.mock('pg', () => {
  const mClient = {
    connect: vi.fn(),
    query: vi.fn(),
    end: vi.fn(),
  };
  return { Client: vi.fn(() => mClient) };
});

vi.mock('drizzle-orm/node-postgres', () => ({
  drizzle: vi.fn(() => ({
    insert: drizzleMocks.insert,
    query: drizzleMocks.query,
  })),
}));

vi.mock('@nexiom/identity/utils/rbac-seeding', () => ({
  seedSystemRbac: rbacMocks.seedSystemRbac,
}));

vi.mock('../constants', () => constantMocks);

describe('DatabaseManager', () => {
  let manager: DatabaseManager;
  const originalEnv = process.env.NODE_ENV;

  beforeEach(() => {
    vi.clearAllMocks();

    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test';
    manager = new DatabaseManager();

    // Default mock behaviors
    drizzleMocks.insert.mockReturnValue({
      values: vi.fn().mockResolvedValue(undefined),
    });
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
    it('should run drizzle-kit migrate via execSync', () => {
      manager.migrate();

      expect(execSync).toHaveBeenCalledWith(
        'pnpm drizzle-kit migrate',
        expect.objectContaining({
          stdio: 'inherit',
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
    });

    it('should skip creating system org if it exists', async () => {
      // Mock db to return existing org
      drizzleMocks.query.organization.findFirst.mockResolvedValueOnce({
        id: 'system-tenant',
      });

      await manager.seed();

      expect(drizzleMocks.insert).not.toHaveBeenCalled();
      expect(rbacMocks.seedSystemRbac).toHaveBeenCalled();
    });
  });

  describe('Error Handling', () => {
    it('should throw if DATABASE_URL is missing', async () => {
      delete process.env.DATABASE_URL;
      await expect(manager.dropAll()).rejects.toThrow(
        'DATABASE_URL is not defined',
      );
    });

    it('should handle truncate errors gracefully', async () => {
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
      await manager.truncateAll();

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
});
