import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DatabaseManager } from './database-manager';
import { execSync } from 'node:child_process';

vi.mock('node:child_process');

describe('DatabaseManager', () => {
  let manager: DatabaseManager;
  const originalEnv = process.env.NODE_ENV;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NODE_ENV = 'test';
    manager = new DatabaseManager();
  });

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  describe('Environment Safety', () => {
    it('should allow operations in test environment', () => {
      process.env.NODE_ENV = 'test';
      expect(() => manager.dropAll()).not.toThrow();
    });

    it('should allow operations in development environment', () => {
      process.env.NODE_ENV = 'development';
      expect(() => new DatabaseManager().dropAll()).not.toThrow();
    });

    it('should block destructive operations in production', () => {
      process.env.NODE_ENV = 'production';
      const prodManager = new DatabaseManager();

      expect(() => prodManager.dropAll()).toThrow(
        'Destructive database operations only allowed',
      );
    });

    it('should block destructive operations in staging', async () => {
      process.env.NODE_ENV = 'staging';
      const stagingManager = new DatabaseManager();

      await expect(stagingManager.fresh()).rejects.toThrow(
        'Destructive database operations only allowed in',
      );
    });
  });

  describe('dropAll()', () => {
    it('should drop drizzle and public schemas', () => {
      manager.dropAll();

      expect(execSync).toHaveBeenCalledWith(
        expect.stringContaining('DROP SCHEMA IF EXISTS drizzle CASCADE'),
        expect.any(Object),
      );
      expect(execSync).toHaveBeenCalledWith(
        expect.stringContaining('DROP SCHEMA IF EXISTS public CASCADE'),
        expect.any(Object),
      );
    });

    it('should recreate public schema', () => {
      manager.dropAll();

      expect(execSync).toHaveBeenCalledWith(
        expect.stringContaining('CREATE SCHEMA public'),
        expect.any(Object),
      );
      expect(execSync).toHaveBeenCalledWith(
        expect.stringContaining('GRANT ALL ON SCHEMA public TO PUBLIC'),
        expect.any(Object),
      );
    });

    it('should throw error if drop fails', () => {
      vi.mocked(execSync).mockImplementationOnce(() => {
        throw new Error('Connection failed');
      });

      expect(() => manager.dropAll()).toThrow('Failed to drop schemas');

      // Reset mock for subsequent tests
      vi.mocked(execSync).mockImplementation(() => Buffer.from(''));
    });
  });

  describe('migrate()', () => {
    it('should run drizzle-kit migrate', () => {
      manager.migrate();

      expect(execSync).toHaveBeenCalledWith(
        'pnpm drizzle-kit migrate',
        expect.objectContaining({
          stdio: 'inherit',
          env: expect.objectContaining({ FORCE_COLOR: '1' }), // eslint-disable-line @typescript-eslint/no-unsafe-assignment
        }),
      );
    });
  });

  describe('truncateAll()', () => {
    it('should truncate all tables', () => {
      manager.truncateAll();

      const call = vi
        .mocked(execSync)
        .mock.calls.find((call) =>
          call[0].toString().includes('TRUNCATE TABLE'),
        );

      expect(call).toBeDefined();
      expect(call![0]).toContain('TRUNCATE TABLE');
      expect(call![0]).toContain('CASCADE');
    });

    it('should handle missing RBAC tables gracefully', () => {
      vi.mocked(execSync)
        .mockImplementationOnce(() => {
          throw new Error('relation "role" does not exist');
        })
        .mockImplementationOnce(() => Buffer.from('TRUNCATE TABLE'));

      expect(() => manager.truncateAll()).not.toThrow();
    });

    it('should handle empty database gracefully', () => {
      vi.mocked(execSync).mockImplementation(() => {
        throw new Error('relation does not exist');
      });

      expect(() => manager.truncateAll()).not.toThrow();
    });
  });

  describe('fresh()', () => {
    it('should call dropAll, migrate, and seed in order', async () => {
      const dropSpy = vi.spyOn(manager, 'dropAll').mockImplementation(() => {});
      const migrateSpy = vi
        .spyOn(manager, 'migrate')
        .mockImplementation(() => {});
      const seedSpy = vi.spyOn(manager, 'seed').mockResolvedValue(undefined);

      await manager.fresh();

      expect(dropSpy).toHaveBeenCalledTimes(1);
      expect(migrateSpy).toHaveBeenCalledTimes(1);
      expect(seedSpy).toHaveBeenCalledTimes(1);
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
        .mockImplementation(() => {});
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
