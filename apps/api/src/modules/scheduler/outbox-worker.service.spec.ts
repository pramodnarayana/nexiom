import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { DATABASE_CONNECTION } from '@nexiom/database';
import { OutboxWorkerService } from './outbox-worker.service.js';
import { SchedulerService } from './scheduler.service.js';

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const CONNECTION_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const RECORD_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

const CONNECTION = {
  id: CONNECTION_ID,
  appName: 'test-app',
  tenantId: 'org-1',
  scheduleEnabled: true,
  syncIntervalMinutes: 30,
};

function makeRecord(
  action: 'CREATED' | 'UPDATED' | 'DELETED',
  attempts = 0,
): typeof import('@nexiom/database').schedulerOutbox.$inferSelect {
  return {
    id: RECORD_ID,
    dataSourceId: CONNECTION_ID,
    action,
    status: 'PROCESSING' as const,
    attempts,
    nextRetryAt: new Date(),
    errorMessage: null,
    processedAt: null,
    createdAt: new Date(),
  };
}

// ---------------------------------------------------------------------------
// Mock DB builder
// ---------------------------------------------------------------------------

function buildMockDb() {
  const returningClaim = vi.fn();
  const findFirstDataSource = vi.fn();

  const markChain = {
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue([]),
  };

  const db = {
    query: {
      dataSources: { findFirst: findFirstDataSource },
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

  return { db, returningClaim, findFirstDataSource, markChain };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('OutboxWorkerService', () => {
  let service: OutboxWorkerService;
  let scheduler: Record<string, ReturnType<typeof vi.fn>>;
  let mocks: ReturnType<typeof buildMockDb>;
  let module: import('@nestjs/testing').TestingModule;

  beforeEach(async () => {
    mocks = buildMockDb();

    scheduler = {
      onConnectionCreated: vi.fn().mockResolvedValue(undefined),
      onConnectionUpdated: vi.fn().mockResolvedValue(undefined),
      onConnectionDeleted: vi.fn().mockResolvedValue(undefined),
    };

    module = await Test.createTestingModule({
      providers: [
        OutboxWorkerService,
        { provide: DATABASE_CONNECTION, useValue: mocks.db },
        { provide: SchedulerService, useValue: scheduler },
      ],
    }).compile();

    service = module.get(OutboxWorkerService);
  });

  afterEach(async () => {
    if (module) {
      await module.close();
    }
  });

  // ── processOutbox ────────────────────────────────────────────────────────

  describe('processOutbox', () => {
    it('is a no-op when no records are claimed', async () => {
      mocks.returningClaim.mockResolvedValue([]);

      await service.processOutbox();

      expect(scheduler.onConnectionCreated).not.toHaveBeenCalled();
      expect(scheduler.onConnectionUpdated).not.toHaveBeenCalled();
      expect(scheduler.onConnectionDeleted).not.toHaveBeenCalled();
    });

    it('calls onConnectionDeleted for a deleted record without reading the connection', async () => {
      const record = makeRecord('DELETED');
      mocks.returningClaim.mockResolvedValue([record]);

      await service.processOutbox();

      expect(scheduler.onConnectionDeleted).toHaveBeenCalledWith(CONNECTION_ID);
      expect(mocks.db.query.dataSources.findFirst).not.toHaveBeenCalled();
    });

    it('calls onConnectionCreated after re-reading the active connection', async () => {
      const record = makeRecord('CREATED');
      mocks.returningClaim.mockResolvedValue([record]);
      mocks.findFirstDataSource.mockResolvedValue(CONNECTION);

      await service.processOutbox();

      expect(mocks.db.query.dataSources.findFirst).toHaveBeenCalled();
      expect(scheduler.onConnectionCreated).toHaveBeenCalledWith(CONNECTION);
    });

    it('calls onConnectionUpdated after re-reading the active connection', async () => {
      const record = makeRecord('UPDATED');
      mocks.returningClaim.mockResolvedValue([record]);
      mocks.findFirstDataSource.mockResolvedValue(CONNECTION);

      await service.processOutbox();

      expect(scheduler.onConnectionUpdated).toHaveBeenCalledWith(CONNECTION);
    });

    it('skips and marks succeeded when connection is absent for created/updated', async () => {
      const record = makeRecord('CREATED');
      mocks.returningClaim.mockResolvedValue([record]);
      mocks.findFirstDataSource.mockResolvedValue(null);

      await service.processOutbox();

      expect(scheduler.onConnectionCreated).not.toHaveBeenCalled();
      // markSucceeded updates the record to 'succeeded'
      expect(mocks.db.update).toHaveBeenCalled();
    });
  });

  // ── retry / backoff ──────────────────────────────────────────────────────

  describe('retry and backoff', () => {
    it('re-queues the record with pending status on transient failure', async () => {
      const record = makeRecord('CREATED', 1);
      mocks.returningClaim.mockResolvedValue([record]);
      mocks.findFirstDataSource.mockResolvedValue(CONNECTION);
      scheduler.onConnectionCreated.mockRejectedValue(
        new Error('Windmill down'),
      );

      await service.processOutbox();

      const setCall = mocks.markChain.set.mock.calls[0][0] as {
        status: string;
        errorMessage: string;
      };
      expect(setCall.status).toBe('PENDING');
      expect(setCall.errorMessage).toContain('Windmill down');
    });

    it('retries with 32s delay when attempts=5 (5th attempt, not yet exhausted)', async () => {
      // With MAX_OUTBOX_ATTEMPTS=6 (1 initial + 5 retries), attempt 5 still retries.
      // Back-off delay = 2^5 * 1000 = 32 000 ms.
      const record = makeRecord('CREATED', 5);
      mocks.returningClaim.mockResolvedValue([record]);
      mocks.findFirstDataSource.mockResolvedValue(CONNECTION);
      scheduler.onConnectionCreated.mockRejectedValue(new Error('still down'));

      await service.processOutbox();

      const setCall = mocks.markChain.set.mock.calls[0][0] as {
        status: string;
        nextRetryAt: Date;
      };
      expect(setCall.status).toBe('PENDING');
      // 32s delay: nextRetryAt should be approximately 32s in the future.
      const delayMs = setCall.nextRetryAt.getTime() - Date.now();
      expect(delayMs).toBeGreaterThan(30_000);
      expect(delayMs).toBeLessThan(34_000);
    });

    it('permanently fails when attempts=6 (all 6 attempts exhausted)', async () => {
      const record = makeRecord('CREATED', 6);
      mocks.returningClaim.mockResolvedValue([record]);
      mocks.findFirstDataSource.mockResolvedValue(CONNECTION);
      scheduler.onConnectionCreated.mockRejectedValue(new Error('still down'));

      await service.processOutbox();

      const setCall = mocks.markChain.set.mock.calls[0][0] as {
        status: string;
        errorMessage: string;
        processedAt: Date;
      };
      expect(setCall.status).toBe('FAILED');
      expect(setCall.errorMessage).toContain('still down');
      expect(setCall.processedAt).toBeInstanceOf(Date);
    });

    it('continues processing remaining records even when one fails', async () => {
      const RECORD_ID_2 = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
      const CONNECTION_ID_2 = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

      const record1 = makeRecord('DELETED');
      const record2 = {
        ...makeRecord('DELETED'),
        id: RECORD_ID_2,
        dataSourceId: CONNECTION_ID_2,
      };
      mocks.returningClaim.mockResolvedValue([record1, record2]);

      scheduler.onConnectionDeleted
        .mockRejectedValueOnce(new Error('transient'))
        .mockResolvedValueOnce(undefined);

      await expect(service.processOutbox()).resolves.toBeUndefined();

      expect(scheduler.onConnectionDeleted).toHaveBeenCalledTimes(2);
    });
  });
});
