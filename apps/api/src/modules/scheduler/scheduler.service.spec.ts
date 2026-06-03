import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { SchedulerService } from './scheduler.service.js';
import { WindmillClient } from './windmill.client.js';
import { SyncRunner } from './sync-runner.js';
import type { InferSelectModel } from 'drizzle-orm';
import { dataSources } from '@soopa/database';

type DataSource = InferSelectModel<typeof dataSources>;

const CONNECTION_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const CONNECTION_ID_2 = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

const CONNECTION = {
  id: CONNECTION_ID,
  appName: 'test-app',
  tenantId: 'org-1',
  scheduleEnabled: true,
  syncIntervalMinutes: 30,
};

describe('SchedulerService', () => {
  let service: SchedulerService;
  let windmill: Record<string, ReturnType<typeof vi.fn>>;
  let module: import('@nestjs/testing').TestingModule;

  beforeEach(async () => {
    windmill = {
      ensureConnectionScript: vi.fn().mockResolvedValue(undefined),
      createSchedule: vi.fn().mockResolvedValue(undefined),
      updateSchedule: vi.fn().mockResolvedValue(true),
      deleteSchedule: vi.fn().mockResolvedValue(undefined),
      triggerOnce: vi.fn().mockResolvedValue('job-abc'),
      scheduleExists: vi.fn().mockResolvedValue(true),
      setScheduleEnabled: vi.fn().mockResolvedValue(undefined),
    };

    const mockSyncRunner = {
      run: vi.fn().mockResolvedValue({
        connectionId: CONNECTION_ID,
        status: 'succeeded',
      }),
    };

    module = await Test.createTestingModule({
      providers: [
        SchedulerService,
        { provide: WindmillClient, useValue: windmill },
        { provide: SyncRunner, useValue: mockSyncRunner },
      ],
    }).compile();

    service = module.get(SchedulerService);
  });

  afterEach(async () => {
    if (module) {
      await module.close();
    }
  });

  // ── onModuleInit ────────────────────────────────────────────────────────

  describe('onModuleInit', () => {
    it('calls ensureConnectionScript on startup', async () => {
      await service.onModuleInit();
      expect(windmill.ensureConnectionScript).toHaveBeenCalledTimes(1);
    });

    it('does not throw if ensureConnectionScript fails (boot resilience)', async () => {
      windmill.ensureConnectionScript.mockRejectedValue(
        new Error('Windmill unreachable'),
      );
      await expect(service.onModuleInit()).resolves.toBeUndefined();
    });
  });

  // ── onConnectionCreated ─────────────────────────────────────────────────────

  describe('onConnectionCreated', () => {
    it('creates a schedule with the correct cron when scheduleEnabled=true', async () => {
      await service.onConnectionCreated(CONNECTION as any as DataSource);
      expect(windmill.createSchedule).toHaveBeenCalledWith(
        CONNECTION_ID,
        '0 0/30 * * * *',
        true,
      );
    });

    it('skips schedule creation when scheduleEnabled=false', async () => {
      await service.onConnectionCreated({
        ...CONNECTION,
        scheduleEnabled: false,
      } as any as DataSource);
      expect(windmill.createSchedule).not.toHaveBeenCalled();
    });

    it('skips and does not throw when syncIntervalMinutes is an unrecognised value', async () => {
      await expect(
        service.onConnectionCreated({
          ...CONNECTION,
          syncIntervalMinutes: 999,
        } as any as DataSource),
      ).resolves.toBeUndefined();
      expect(windmill.createSchedule).not.toHaveBeenCalled();
    });
  });

  // ── onConnectionUpdated ─────────────────────────────────────────────────────

  describe('onConnectionUpdated', () => {
    it('updates the existing schedule when Windmill reports it exists (returns true)', async () => {
      windmill.updateSchedule.mockResolvedValue(true);

      await service.onConnectionUpdated(CONNECTION as any as DataSource);

      expect(windmill.updateSchedule).toHaveBeenCalledWith(
        CONNECTION_ID,
        '0 0/30 * * * *',
        true,
      );
      expect(windmill.createSchedule).not.toHaveBeenCalled();
    });

    it('creates a new schedule when updateSchedule returns false (schedule not found)', async () => {
      windmill.updateSchedule.mockResolvedValue(false);

      await service.onConnectionUpdated(CONNECTION as any as DataSource);

      expect(windmill.updateSchedule).toHaveBeenCalled();
      expect(windmill.createSchedule).toHaveBeenCalledWith(
        CONNECTION_ID,
        '0 0/30 * * * *',
        true,
      );
    });

    it('passes enabled=false when scheduleEnabled is false', async () => {
      windmill.updateSchedule.mockResolvedValue(true);

      await service.onConnectionUpdated({
        ...CONNECTION,
        scheduleEnabled: false,
      } as any as DataSource);

      expect(windmill.updateSchedule).toHaveBeenCalledWith(
        CONNECTION_ID,
        expect.any(String),
        false,
      );
    });

    it('skips when syncIntervalMinutes is an unrecognised value', async () => {
      await expect(
        service.onConnectionUpdated({
          ...CONNECTION,
          syncIntervalMinutes: 0,
        } as any as DataSource),
      ).resolves.toBeUndefined();
      expect(windmill.updateSchedule).not.toHaveBeenCalled();
    });

    it('uses the correct cron for each valid interval', async () => {
      const cases: [number, string][] = [
        [60, '0 0 * * * *'],
        [120, '0 0 */2 * * *'],
        [1440, '0 0 0 * * *'],
      ];
      for (const [minutes, expectedCron] of cases) {
        windmill.updateSchedule.mockResolvedValue(true);
        await service.onConnectionUpdated({
          ...CONNECTION,
          syncIntervalMinutes: minutes,
        } as any as DataSource);
        expect(windmill.updateSchedule).toHaveBeenCalledWith(
          CONNECTION_ID,
          expectedCron,
          true,
        );
        windmill.updateSchedule.mockClear();
      }
    });
  });

  // ── onConnectionDeleted ─────────────────────────────────────────────────────

  describe('onConnectionDeleted', () => {
    it('delegates to windmill.deleteSchedule', async () => {
      await service.onConnectionDeleted(CONNECTION_ID);
      expect(windmill.deleteSchedule).toHaveBeenCalledWith(CONNECTION_ID);
    });
  });

  // ── deleteOrgSchedules ──────────────────────────────────────────────────

  describe('deleteOrgSchedules', () => {
    it('deletes schedules for all provided connection IDs', async () => {
      await service.deleteOrgSchedules([CONNECTION_ID, CONNECTION_ID_2]);
      expect(windmill.deleteSchedule).toHaveBeenCalledTimes(2);
      expect(windmill.deleteSchedule).toHaveBeenCalledWith(CONNECTION_ID);
      expect(windmill.deleteSchedule).toHaveBeenCalledWith(CONNECTION_ID_2);
    });

    it('resolves even when some deletions fail (logs individually)', async () => {
      windmill.deleteSchedule
        .mockRejectedValueOnce(new Error('not found'))
        .mockResolvedValueOnce(undefined);

      await expect(
        service.deleteOrgSchedules([CONNECTION_ID, CONNECTION_ID_2]),
      ).resolves.toBeUndefined();

      expect(windmill.deleteSchedule).toHaveBeenCalledTimes(2);
    });

    it('is a no-op for an empty list', async () => {
      await service.deleteOrgSchedules([]);
      expect(windmill.deleteSchedule).not.toHaveBeenCalled();
    });
  });

  // ── triggerOnce ─────────────────────────────────────────────────────────

  describe('triggerOnce', () => {
    it('returns the Windmill job ID', async () => {
      const jobId = await service.triggerOnce(CONNECTION_ID);
      expect(jobId).toBe('job-abc');
      expect(windmill.triggerOnce).toHaveBeenCalledWith(CONNECTION_ID);
    });
  });

  // ── executeConnection ───────────────────────────────────────────────────────

  describe('executeConnection', () => {
    it('delegates to SyncRunner and returns the result', async () => {
      const result = await service.executeConnection(CONNECTION_ID);
      expect(result).toEqual({
        connectionId: CONNECTION_ID,
        status: 'succeeded',
      });
    });
  });
});
