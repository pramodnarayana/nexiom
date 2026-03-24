import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { DATABASE_CONNECTION } from '@nexiom/database';
import { OutboxWorkerService } from './outbox-worker.service.js';
import { SchedulerService } from './scheduler.service.js';

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const STITCH_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const RECORD_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

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

function makeRecord(
  action: 'created' | 'updated' | 'deleted',
  attempts = 0,
): typeof import('@nexiom/database').schedulerOutbox.$inferSelect {
  return {
    id: RECORD_ID,
    stitchId: STITCH_ID,
    action,
    status: 'processing' as const,
    attempts,
    nextRetryAt: new Date(),
    lastError: null,
    processedAt: null,
    createdAt: new Date(),
  };
}

// ---------------------------------------------------------------------------
// Mock DB builder
// ---------------------------------------------------------------------------

function buildMockDb() {
  const returningClaim = vi.fn();
  const findFirstStitch = vi.fn();

  const markChain = {
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue([]),
  };

  const db = {
    query: {
      integrationStitches: { findFirst: findFirstStitch },
    },
    transaction: vi
      .fn()
      .mockImplementation((fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          update: vi.fn().mockReturnValue({
            set: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({ returning: returningClaim }),
            }),
          }),
        }),
      ),
    // top-level update used by markSucceeded / handleFailure
    update: vi.fn().mockReturnValue(markChain),
  };

  return { db, returningClaim, findFirstStitch, markChain };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('OutboxWorkerService', () => {
  let service: OutboxWorkerService;
  let scheduler: Record<string, ReturnType<typeof vi.fn>>;
  let mocks: ReturnType<typeof buildMockDb>;

  beforeEach(async () => {
    mocks = buildMockDb();

    scheduler = {
      onStitchCreated: vi.fn().mockResolvedValue(undefined),
      onStitchUpdated: vi.fn().mockResolvedValue(undefined),
      onStitchDeleted: vi.fn().mockResolvedValue(undefined),
    };

    const module = await Test.createTestingModule({
      providers: [
        OutboxWorkerService,
        { provide: DATABASE_CONNECTION, useValue: mocks.db },
        { provide: SchedulerService, useValue: scheduler },
      ],
    }).compile();

    service = module.get(OutboxWorkerService);
  });

  // ── processOutbox ────────────────────────────────────────────────────────

  describe('processOutbox', () => {
    it('is a no-op when no records are claimed', async () => {
      mocks.returningClaim.mockResolvedValue([]);

      await service.processOutbox();

      expect(scheduler.onStitchCreated).not.toHaveBeenCalled();
      expect(scheduler.onStitchUpdated).not.toHaveBeenCalled();
      expect(scheduler.onStitchDeleted).not.toHaveBeenCalled();
    });

    it('calls onStitchDeleted for a deleted record without reading the stitch', async () => {
      const record = makeRecord('deleted');
      mocks.returningClaim.mockResolvedValue([record]);

      await service.processOutbox();

      expect(scheduler.onStitchDeleted).toHaveBeenCalledWith(STITCH_ID);
      expect(
        mocks.db.query.integrationStitches.findFirst,
      ).not.toHaveBeenCalled();
    });

    it('calls onStitchCreated after re-reading the active stitch', async () => {
      const record = makeRecord('created');
      mocks.returningClaim.mockResolvedValue([record]);
      mocks.findFirstStitch.mockResolvedValue(STITCH);

      await service.processOutbox();

      expect(mocks.db.query.integrationStitches.findFirst).toHaveBeenCalled();
      expect(scheduler.onStitchCreated).toHaveBeenCalledWith(STITCH);
    });

    it('calls onStitchUpdated after re-reading the active stitch', async () => {
      const record = makeRecord('updated');
      mocks.returningClaim.mockResolvedValue([record]);
      mocks.findFirstStitch.mockResolvedValue(STITCH);

      await service.processOutbox();

      expect(scheduler.onStitchUpdated).toHaveBeenCalledWith(STITCH);
    });

    it('skips and marks succeeded when stitch is absent for created/updated', async () => {
      const record = makeRecord('created');
      mocks.returningClaim.mockResolvedValue([record]);
      mocks.findFirstStitch.mockResolvedValue(null);

      await service.processOutbox();

      expect(scheduler.onStitchCreated).not.toHaveBeenCalled();
      // markSucceeded updates the record to 'succeeded'
      expect(mocks.db.update).toHaveBeenCalled();
    });

    it('skips and marks succeeded when stitch is ARCHIVED for updated', async () => {
      const record = makeRecord('updated');
      mocks.returningClaim.mockResolvedValue([record]);
      mocks.findFirstStitch.mockResolvedValue({
        ...STITCH,
        status: 'ARCHIVED' as const,
      });

      await service.processOutbox();

      expect(scheduler.onStitchUpdated).not.toHaveBeenCalled();
      expect(mocks.db.update).toHaveBeenCalled();
    });
  });

  // ── retry / backoff ──────────────────────────────────────────────────────

  describe('retry and backoff', () => {
    it('re-queues the record with pending status on transient failure', async () => {
      const record = makeRecord('created', 1);
      mocks.returningClaim.mockResolvedValue([record]);
      mocks.findFirstStitch.mockResolvedValue(STITCH);
      scheduler.onStitchCreated.mockRejectedValue(new Error('Windmill down'));

      await service.processOutbox();

      const setCall = mocks.markChain.set.mock.calls[0][0] as {
        status: string;
        lastError: string;
      };
      expect(setCall.status).toBe('pending');
      expect(setCall.lastError).toContain('Windmill down');
    });

    it('marks record as failed after MAX_OUTBOX_ATTEMPTS attempts', async () => {
      // attempts=5 means we are AT the limit — next failure should permanently fail
      const record = makeRecord('created', 5);
      mocks.returningClaim.mockResolvedValue([record]);
      mocks.findFirstStitch.mockResolvedValue(STITCH);
      scheduler.onStitchCreated.mockRejectedValue(new Error('still down'));

      await service.processOutbox();

      const setCall = mocks.markChain.set.mock.calls[0][0] as {
        status: string;
        lastError: string;
        processedAt: Date;
      };
      expect(setCall.status).toBe('failed');
      expect(setCall.lastError).toContain('still down');
      expect(setCall.processedAt).toBeInstanceOf(Date);
    });

    it('continues processing remaining records even when one fails', async () => {
      const RECORD_ID_2 = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
      const STITCH_ID_2 = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

      const record1 = makeRecord('deleted');
      const record2 = {
        ...makeRecord('deleted'),
        id: RECORD_ID_2,
        stitchId: STITCH_ID_2,
      };
      mocks.returningClaim.mockResolvedValue([record1, record2]);

      scheduler.onStitchDeleted
        .mockRejectedValueOnce(new Error('transient'))
        .mockResolvedValueOnce(undefined);

      await expect(service.processOutbox()).resolves.toBeUndefined();

      expect(scheduler.onStitchDeleted).toHaveBeenCalledTimes(2);
    });
  });
});
