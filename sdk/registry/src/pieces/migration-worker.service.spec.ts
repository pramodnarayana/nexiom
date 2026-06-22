import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Mocked } from 'vitest';
import { MigrationWorkerService } from './migration-worker.service.js';
import type { DrizzleDb } from '@soopa/database';
import { QueueName } from '@soopa/queue';
import type { IQueueService, PluginMigrationEvent } from '@soopa/queue';

import type { DatabaseManager } from '@soopa/dbmanager';

/**
 * Typed accessor for MigrationWorkerService private methods.
 * vi.spyOn requires the second argument to be a keyof T where T[K] is a function.
 * Casting to Record<string, unknown> resolves K to `never` (unknown ≠ function),
 * so we use a concrete interface that mirrors the private method signatures.
 */
type MigrationWorkerPrivate = {
  getActiveTenants(): Promise<Array<{ id: string }>>;
  getTenantDbConnection(tenantId: string): Promise<DrizzleDb>;
  isPluginMigrationEvent(event: unknown): event is PluginMigrationEvent;
};

import { MigrationRunnerPort } from '@soopa/migrator';

describe('MigrationWorkerService', () => {
  let service: MigrationWorkerService;
  let globalDb: Mocked<DrizzleDb>;
  let dbManager: Mocked<DatabaseManager>;
  let queueService: Mocked<IQueueService>;
  let migratorMock: Mocked<MigrationRunnerPort>;

  beforeEach(() => {
    globalDb = {} as unknown as Mocked<DrizzleDb>;
    dbManager = { getTenantDb: vi.fn() } as unknown as Mocked<DatabaseManager>;
    queueService = {
      send: vi.fn(),
      consume: vi.fn(),
    } as unknown as Mocked<IQueueService>;

    migratorMock = {
      runMigrations: vi.fn().mockResolvedValue(undefined),
    } as unknown as Mocked<MigrationRunnerPort>;

    service = new MigrationWorkerService(globalDb, dbManager, queueService, migratorMock);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ── onModuleInit: consumer registration ──────────────────────────────────

  describe('onModuleInit', () => {
    it('should register a consumer on the TenantProvisionQueue', () => {
      service.onModuleInit();
      expect(queueService.consume).toHaveBeenCalledWith(
        QueueName.TenantProvisionQueue,
        expect.any(Function),
      );
    });

    it('should throw for a non-plugin-migration message so SQS can requeue it', async () => {
      service.onModuleInit();
      const consumer = queueService.consume.mock.calls[0][1] as (
        msg: unknown,
      ) => Promise<void>;

      await expect(consumer({ invalid: 'event' })).rejects.toThrow(
        'Not a plugin migration event',
      );
    });

    it('should process a valid PluginMigrationEvent in the consumer', async () => {
      vi.spyOn(service, 'runBackgroundMigrations').mockResolvedValueOnce(
        undefined,
      );
      service.onModuleInit();
      const consumer = queueService.consume.mock.calls[0][1] as (
        msg: unknown,
      ) => Promise<void>;

      await consumer({
        pluginLocation: '/tmp/plugin',
        pieceName: '@soopa/piece-slack',
      });

      expect(service.runBackgroundMigrations).toHaveBeenCalled();
    });
  });

  // ── isPluginMigrationEvent: type guard with `unknown` input ─────────────

  describe('isPluginMigrationEvent (type guard)', () => {
    const guard = (e: unknown) =>
      (service as unknown as Record<string, (e: unknown) => boolean>)[
        'isPluginMigrationEvent'
      ](e);

    it('should accept a valid PluginMigrationEvent', () => {
      expect(
        guard({ pluginLocation: '/a', pieceName: '@soopa/piece-x' }),
      ).toBe(true);
    });

    it('should reject null', () => {
      expect(guard(null)).toBe(false);
    });

    it('should reject a string (primitive)', () => {
      expect(guard('some string')).toBe(false);
    });

    it('should reject an object missing pieceName', () => {
      expect(guard({ pluginLocation: '/a' })).toBe(false);
    });

    it('should reject an object with numeric fields (type mismatch)', () => {
      expect(guard({ pluginLocation: 1, pieceName: 2 })).toBe(false);
    });
  });

  // ── runBackgroundMigrations: fan-out mode ─────────────────────────────────

  describe('runBackgroundMigrations — fan-out mode (no tenantId)', () => {
    it('should dispatch one SQS message per active tenant', async () => {
      vi.spyOn(service as unknown as MigrationWorkerPrivate, 'getActiveTenants').mockResolvedValue([
        { id: 't1' },
        { id: 't2' },
      ]);
      vi.spyOn(service as unknown as MigrationWorkerPrivate, 'getTenantDbConnection').mockResolvedValue({} as DrizzleDb);

      await service.runBackgroundMigrations({
        pluginLocation: '/tmp/plugin',
        pieceName: '@soopa/piece-migrate',
      });

      expect(queueService.send).toHaveBeenCalledTimes(2);
      expect(queueService.send).toHaveBeenNthCalledWith(
        1,
        QueueName.TenantProvisionQueue,
        {
          pluginLocation: '/tmp/plugin',
          pieceName: '@soopa/piece-migrate',
          tenantId: 't1',
        },
      );
      expect(queueService.send).toHaveBeenNthCalledWith(
        2,
        QueueName.TenantProvisionQueue,
        {
          pluginLocation: '/tmp/plugin',
          pieceName: '@soopa/piece-migrate',
          tenantId: 't2',
        },
      );
      // Fan-out mode must NOT run the migrator itself
      expect(migratorMock.runMigrations).not.toHaveBeenCalled();
    });
  });

  // ── runBackgroundMigrations: worker mode ──────────────────────────────────

  describe('runBackgroundMigrations — worker mode (with tenantId)', () => {
    it('should run Drizzle migrate for the specified tenant', async () => {
      const getActiveTenantsSpy = vi.spyOn(
        service as unknown as MigrationWorkerPrivate,
        'getActiveTenants',
      ).mockResolvedValue([]);
      const getTenantDbSpy = vi.spyOn(
        service as unknown as MigrationWorkerPrivate,
        'getTenantDbConnection',
      ).mockResolvedValue({} as DrizzleDb);

      await service.runBackgroundMigrations({
        pluginLocation: '/tmp/plugin',
        pieceName: '@soopa/piece-migrate',
        tenantId: 'tenant-555',
      });

      // Must NOT fan-out in worker mode
      expect(getActiveTenantsSpy).not.toHaveBeenCalled();
      expect(queueService.send).not.toHaveBeenCalled();

      expect(getTenantDbSpy).toHaveBeenCalledWith('tenant-555');
      expect(migratorMock.runMigrations).toHaveBeenCalledWith(expect.any(Object), {
        migrationsFolder: '/tmp/plugin/drizzle/migrations',
      });
    });

    it('should re-throw migration errors so SQS routes to DLQ', async () => {
      vi.spyOn(service as unknown as MigrationWorkerPrivate, 'getActiveTenants').mockResolvedValue([]);
      vi.spyOn(service as unknown as MigrationWorkerPrivate, 'getTenantDbConnection').mockResolvedValue({} as DrizzleDb);
      migratorMock.runMigrations.mockRejectedValueOnce(new Error('DB Timeout'));

      await expect(
        service.runBackgroundMigrations({
          pluginLocation: '/tmp/plugin',
          pieceName: '@soopa/piece-migrate',
          tenantId: 'tenant-999',
        }),
      ).rejects.toThrow('DB Timeout');
    });
  });

  // ── Private helpers ───────────────────────────────────────────────────────

  describe('Private helpers', () => {
    it('getActiveTenants should query the global DB', async () => {
      const mockSelect = {
        from: vi.fn().mockResolvedValue([{ id: 'tenant-1' }]),
      };
      (globalDb as unknown as Record<string, unknown>).select = vi
        .fn()
        .mockReturnValue(mockSelect);

      const res = await (
        service as unknown as Record<
          string,
          () => Promise<Array<{ id: string }>>
        >
      )['getActiveTenants']();

      expect(res).toEqual([{ id: 'tenant-1' }]);
    });

    it('getTenantDbConnection should delegate to dbManager.getTenantDb', async () => {
      const fakeDb = { dummy: true };
      dbManager.getTenantDb.mockResolvedValue(fakeDb as unknown as DrizzleDb);

      const res = await (
        service as unknown as Record<
          string,
          (id: string) => Promise<DrizzleDb>
        >
      )['getTenantDbConnection']('tenant-1');

      expect(res).toBe(fakeDb);
    });
  });
});
