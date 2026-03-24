import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { SchedulerService } from './scheduler.service.js';
import { WindmillClient } from './windmill.client.js';

const STITCH_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const STITCH_ID_2 = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

const STITCH = {
  id: STITCH_ID,
  name: 'Test Stitch',
  orgId: 'org-1',
  workspaceId: 'ws-1',
  srcConnectionId: 'conn-1',
  destConnectionId: 'conn-2',
  sourceObject: 'Lead',
  targetObject: 'Contact',
  syncCondition: [],
  status: 'ACTIVE' as const,
  syncIntervalMinutes: 30,
  scheduleEnabled: true,
  lastScheduledAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('SchedulerService', () => {
  let service: SchedulerService;
  let windmill: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(async () => {
    windmill = {
      ensureStitchScript: vi.fn().mockResolvedValue(undefined),
      createSchedule: vi.fn().mockResolvedValue(undefined),
      updateSchedule: vi.fn().mockResolvedValue(true),
      deleteSchedule: vi.fn().mockResolvedValue(undefined),
      triggerOnce: vi.fn().mockResolvedValue('job-abc'),
      scheduleExists: vi.fn().mockResolvedValue(true),
      setScheduleEnabled: vi.fn().mockResolvedValue(undefined),
    };

    const module = await Test.createTestingModule({
      providers: [
        SchedulerService,
        { provide: WindmillClient, useValue: windmill },
      ],
    }).compile();

    service = module.get(SchedulerService);
  });

  // ── onModuleInit ────────────────────────────────────────────────────────

  describe('onModuleInit', () => {
    it('calls ensureStitchScript on startup', async () => {
      await service.onModuleInit();
      expect(windmill.ensureStitchScript).toHaveBeenCalledTimes(1);
    });

    it('does not throw if ensureStitchScript fails (boot resilience)', async () => {
      windmill.ensureStitchScript.mockRejectedValue(
        new Error('Windmill unreachable'),
      );
      await expect(service.onModuleInit()).resolves.toBeUndefined();
    });
  });

  // ── onStitchCreated ─────────────────────────────────────────────────────

  describe('onStitchCreated', () => {
    it('creates a schedule with the correct cron when scheduleEnabled=true', async () => {
      await service.onStitchCreated(STITCH);
      expect(windmill.createSchedule).toHaveBeenCalledWith(
        STITCH_ID,
        '0 0/30 * * * *',
        true,
      );
    });

    it('skips schedule creation when scheduleEnabled=false', async () => {
      await service.onStitchCreated({ ...STITCH, scheduleEnabled: false });
      expect(windmill.createSchedule).not.toHaveBeenCalled();
    });

    it('skips and does not throw when syncIntervalMinutes is an unrecognised value', async () => {
      await expect(
        service.onStitchCreated({ ...STITCH, syncIntervalMinutes: 999 }),
      ).resolves.toBeUndefined();
      expect(windmill.createSchedule).not.toHaveBeenCalled();
    });
  });

  // ── onStitchUpdated ─────────────────────────────────────────────────────

  describe('onStitchUpdated', () => {
    it('updates the existing schedule when Windmill reports it exists (returns true)', async () => {
      windmill.updateSchedule.mockResolvedValue(true);

      await service.onStitchUpdated(STITCH);

      expect(windmill.updateSchedule).toHaveBeenCalledWith(
        STITCH_ID,
        '0 0/30 * * * *',
        true,
      );
      expect(windmill.createSchedule).not.toHaveBeenCalled();
    });

    it('creates a new schedule when updateSchedule returns false (schedule not found)', async () => {
      windmill.updateSchedule.mockResolvedValue(false);

      await service.onStitchUpdated(STITCH);

      expect(windmill.updateSchedule).toHaveBeenCalled();
      expect(windmill.createSchedule).toHaveBeenCalledWith(
        STITCH_ID,
        '0 0/30 * * * *',
        true,
      );
    });

    it('passes enabled=false when scheduleEnabled is false', async () => {
      windmill.updateSchedule.mockResolvedValue(true);

      await service.onStitchUpdated({ ...STITCH, scheduleEnabled: false });

      expect(windmill.updateSchedule).toHaveBeenCalledWith(
        STITCH_ID,
        expect.any(String),
        false,
      );
    });

    it('skips when syncIntervalMinutes is an unrecognised value', async () => {
      await expect(
        service.onStitchUpdated({ ...STITCH, syncIntervalMinutes: 0 }),
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
        await service.onStitchUpdated({
          ...STITCH,
          syncIntervalMinutes: minutes,
        });
        expect(windmill.updateSchedule).toHaveBeenCalledWith(
          STITCH_ID,
          expectedCron,
          true,
        );
        vi.clearAllMocks();
        windmill.updateSchedule = vi.fn().mockResolvedValue(true);
      }
    });
  });

  // ── onStitchDeleted ─────────────────────────────────────────────────────

  describe('onStitchDeleted', () => {
    it('delegates to windmill.deleteSchedule', async () => {
      await service.onStitchDeleted(STITCH_ID);
      expect(windmill.deleteSchedule).toHaveBeenCalledWith(STITCH_ID);
    });
  });

  // ── deleteOrgSchedules ──────────────────────────────────────────────────

  describe('deleteOrgSchedules', () => {
    it('deletes schedules for all provided stitch IDs', async () => {
      await service.deleteOrgSchedules([STITCH_ID, STITCH_ID_2]);
      expect(windmill.deleteSchedule).toHaveBeenCalledTimes(2);
      expect(windmill.deleteSchedule).toHaveBeenCalledWith(STITCH_ID);
      expect(windmill.deleteSchedule).toHaveBeenCalledWith(STITCH_ID_2);
    });

    it('resolves even when some deletions fail (logs individually)', async () => {
      windmill.deleteSchedule
        .mockRejectedValueOnce(new Error('not found'))
        .mockResolvedValueOnce(undefined);

      await expect(
        service.deleteOrgSchedules([STITCH_ID, STITCH_ID_2]),
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
      const jobId = await service.triggerOnce(STITCH_ID);
      expect(jobId).toBe('job-abc');
      expect(windmill.triggerOnce).toHaveBeenCalledWith(STITCH_ID);
    });
  });

  // ── executeStitch ───────────────────────────────────────────────────────

  describe('executeStitch', () => {
    it('returns accepted status with the stitch ID', async () => {
      const result = await service.executeStitch(STITCH_ID);
      expect(result).toEqual({ stitchId: STITCH_ID, status: 'accepted' });
    });
  });
});
