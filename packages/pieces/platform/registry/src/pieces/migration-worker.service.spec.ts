import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Mocked } from 'vitest';
import { MigrationWorkerService } from './migration-worker.service.js';
import type { DrizzleDb } from '@soopa/database';
import { QueueName } from '@soopa/queue';
import type { IQueueService } from '@soopa/queue';
import * as migrator from 'drizzle-orm/node-postgres/migrator';
import type { DatabaseManager } from '@soopa/dbmanager';

vi.mock('drizzle-orm/node-postgres/migrator', () => ({
  migrate: vi.fn().mockResolvedValue(undefined)
}));

describe('MigrationWorkerService', () => {
  let service: MigrationWorkerService;
  let globalDb: Mocked<DrizzleDb>;
  let dbManager: Mocked<DatabaseManager>;
  let queueService: Mocked<IQueueService>;

  beforeEach(() => {
    globalDb = {} as unknown as Mocked<DrizzleDb>;
    dbManager = { getTenantDb: vi.fn() } as unknown as Mocked<DatabaseManager>;
    
    queueService = {
      send: vi.fn(),
      consume: vi.fn(),
    } as unknown as Mocked<IQueueService>;

    service = new MigrationWorkerService(globalDb, dbManager, queueService);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('runBackgroundMigrations', () => {
    let originalEnablePluginMigrations: string | undefined;

    beforeEach(() => {
      originalEnablePluginMigrations = process.env.ENABLE_PLUGIN_MIGRATIONS;
      // Enable migrations for tests that need tenant handlers
      process.env.ENABLE_PLUGIN_MIGRATIONS = 'true';
    });

    afterEach(() => {
      if (originalEnablePluginMigrations === undefined) {
        delete process.env.ENABLE_PLUGIN_MIGRATIONS;
      } else {
        process.env.ENABLE_PLUGIN_MIGRATIONS = originalEnablePluginMigrations;
      }
    });

    it('should abort gracefully if tenant handlers are not available', async () => {
      delete process.env.ENABLE_PLUGIN_MIGRATIONS;

      await service.runBackgroundMigrations({
        pluginLocation: '/tmp/plugin',
        pieceName: '@soopa/piece-migrate'
      });
      
      expect(queueService.send).not.toHaveBeenCalled();
    });

    it('should Fan-out to multiple queue messages if tenantId is missing', async () => {
      // Mock the internal getActiveTenants helper
      const getActiveTenantsSpy = vi.spyOn(service as any, 'getActiveTenants').mockResolvedValue([
        { id: 't1' },
        { id: 't2' }
      ]);
      vi.spyOn(service as any, 'getTenantDbConnection').mockResolvedValue({} as any);

      await service.runBackgroundMigrations({
        pluginLocation: '/tmp/plugin',
        pieceName: '@soopa/piece-migrate'
      });

      expect(getActiveTenantsSpy).toHaveBeenCalled();

      // It should have fanned out into 2 explicit queue messages
      expect(queueService.send).toHaveBeenCalledTimes(2);
      expect(queueService.send).toHaveBeenNthCalledWith(1, QueueName.TenantProvisionQueue, {
        pluginLocation: '/tmp/plugin',
        pieceName: '@soopa/piece-migrate',
        tenantId: 't1'
      });
      expect(queueService.send).toHaveBeenNthCalledWith(2, QueueName.TenantProvisionQueue, {
        pluginLocation: '/tmp/plugin',
        pieceName: '@soopa/piece-migrate',
        tenantId: 't2'
      });

      // Should not run migrations itself in Fan-Out mode
      expect(migrator.migrate).not.toHaveBeenCalled();
    });

    it('should execute single-tenant migration if tenantId is provided', async () => {
      const getActiveTenantsSpy = vi.spyOn(service as any, 'getActiveTenants').mockResolvedValue([]);
      const getTenantDbSpy = vi.spyOn(service as any, 'getTenantDbConnection').mockResolvedValue({} as any);

      await service.runBackgroundMigrations({
        pluginLocation: '/tmp/plugin',
        pieceName: '@soopa/piece-migrate',
        tenantId: 'tenant-555'
      });

      // Should bypass fan-out
      expect(getActiveTenantsSpy).not.toHaveBeenCalled();
      expect(queueService.send).not.toHaveBeenCalled();

      // Should resolve the specific tenant DB and run migration
      expect(getTenantDbSpy).toHaveBeenCalledWith('tenant-555');
      expect(migrator.migrate).toHaveBeenCalledWith(expect.any(Object), { migrationsFolder: '/tmp/plugin/drizzle/migrations' });
    });

    it('should throw an error if single-tenant migration fails to trigger Dead-Letter Queue', async () => {
      vi.spyOn(service as any, 'getActiveTenants').mockResolvedValue([]);
      vi.spyOn(service as any, 'getTenantDbConnection').mockResolvedValue({} as any);
      (migrator.migrate as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('DB Timeout'));

      await expect(service.runBackgroundMigrations({
        pluginLocation: '/tmp/plugin',
        pieceName: '@soopa/piece-migrate',
        tenantId: 'tenant-999'
      })).rejects.toThrow('DB Timeout');
    });
  });
});
