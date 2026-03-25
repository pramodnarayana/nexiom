import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { AuthGuard } from '@nexiom/auth';
import { DATABASE_CONNECTION } from '@nexiom/database';
import { integrationStitches, syncCursors } from '@nexiom/database';
import { REDIS_CLIENT } from '@nexiom/cache';
import { SystemAdminGuard } from '../identity/auth/system-admin.guard.js';
import { CursorResetController } from './cursor-reset.controller.js';

const STITCH_ID = '550e8400-e29b-41d4-a716-446655440000';
const STREAM_NAME = 'Account';

const mockCtx = {
  user: { id: 'u1', email: 'admin@example.com' },
} as unknown as import('@nexiom/auth').RequestAuthContext;

function createMockDb() {
  const chain = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
  };
  return chain;
}

function createMockRedis() {
  return {
    // SET NX: returns 'OK' (lock acquired) or null (already held)
    set: vi.fn().mockResolvedValue('OK'),
    del: vi.fn().mockResolvedValue(1),
  };
}

type MockDb = ReturnType<typeof createMockDb>;
type MockRedis = ReturnType<typeof createMockRedis>;

describe('CursorResetController', () => {
  let controller: CursorResetController;
  let mockDb: MockDb;
  let mockRedis: MockRedis;

  beforeEach(async () => {
    mockDb = createMockDb();
    mockRedis = createMockRedis();

    const module = await Test.createTestingModule({
      controllers: [CursorResetController],
      providers: [
        { provide: DATABASE_CONNECTION, useValue: mockDb },
        { provide: REDIS_CLIENT, useValue: mockRedis },
      ],
    })
      .overrideGuard(AuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(SystemAdminGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(CursorResetController);
    vi.clearAllMocks();
  });

  // ── DELETE ──────────────────────────────────────────────────────────────

  it('DELETE acquires lock, deletes cursor, releases lock', async () => {
    mockRedis.set.mockResolvedValue('OK');
    mockDb.delete.mockReturnValue(mockDb);
    mockDb.where.mockResolvedValue(undefined);

    const result = await controller.deleteCursor(
      STITCH_ID,
      STREAM_NAME,
      mockCtx,
    );

    expect(result).toBeUndefined();
    // Lock acquired then released
    expect(mockRedis.set).toHaveBeenCalledOnce();
    expect(mockRedis.del).toHaveBeenCalledOnce();
    expect(mockDb.delete).toHaveBeenCalledOnce();
  });

  it('DELETE is idempotent — no error when row is absent', async () => {
    mockRedis.set.mockResolvedValue('OK');
    mockDb.delete.mockReturnValue(mockDb);
    mockDb.where.mockResolvedValue(undefined);

    await expect(
      controller.deleteCursor(STITCH_ID, STREAM_NAME, mockCtx),
    ).resolves.not.toThrow();
  });

  it('DELETE releases lock even when DB delete throws', async () => {
    mockRedis.set.mockResolvedValue('OK');
    mockDb.delete.mockReturnValue(mockDb);
    mockDb.where.mockRejectedValue(new Error('DB error'));

    await expect(
      controller.deleteCursor(STITCH_ID, STREAM_NAME, mockCtx),
    ).rejects.toThrow('DB error');

    // Lock must be released in finally
    expect(mockRedis.del).toHaveBeenCalledOnce();
  });

  it('DELETE throws ConflictException when poll lock is already held (NX fails)', async () => {
    mockRedis.set.mockResolvedValue(null); // NX fails — lock is held

    await expect(
      controller.deleteCursor(STITCH_ID, STREAM_NAME, mockCtx),
    ).rejects.toThrow(ConflictException);

    // Must not attempt DB delete
    expect(mockDb.delete).not.toHaveBeenCalled();
    // Must not attempt lock release (never acquired it)
    expect(mockRedis.del).not.toHaveBeenCalled();
  });

  it('DELETE uses the correct lock key format', async () => {
    mockRedis.set.mockResolvedValue('OK');
    mockDb.delete.mockReturnValue(mockDb);
    mockDb.where.mockResolvedValue(undefined);

    await controller.deleteCursor(STITCH_ID, STREAM_NAME, mockCtx);

    expect(mockRedis.set).toHaveBeenCalledWith(
      `lock:poll:${STITCH_ID}:${STREAM_NAME}`,
      'admin-reset',
      'PX',
      expect.any(Number),
      'NX',
    );
  });

  it('DELETE rejects streamName with newline characters', async () => {
    await expect(
      controller.deleteCursor(STITCH_ID, 'Account\nevil-log-line', mockCtx),
    ).rejects.toThrow(BadRequestException);
  });

  it('DELETE rejects streamName with null bytes', async () => {
    await expect(
      controller.deleteCursor(STITCH_ID, 'Account\x00', mockCtx),
    ).rejects.toThrow(BadRequestException);
  });

  it('DELETE rejects streamName longer than 200 characters', async () => {
    const longName = 'a'.repeat(201);
    await expect(
      controller.deleteCursor(STITCH_ID, longName, mockCtx),
    ).rejects.toThrow(BadRequestException);
  });

  // ── GET ─────────────────────────────────────────────────────────────────

  it('GET returns cursors with stale: true when age exceeds 2x interval', async () => {
    const now = Date.now();
    const sixtyOneMinutesAgo = new Date(now - 61 * 60_000);

    mockDb.from.mockImplementation((table: unknown) => {
      if (table === integrationStitches) {
        mockDb.where.mockReturnValueOnce(mockDb);
        mockDb.limit.mockResolvedValueOnce([
          { syncIntervalMinutes: 30, scheduleEnabled: true },
        ]);
      } else if (table === syncCursors) {
        mockDb.where.mockResolvedValueOnce([
          {
            id: 'c1',
            stitchId: STITCH_ID,
            streamName: STREAM_NAME,
            createdAt: sixtyOneMinutesAgo,
            updatedAt: sixtyOneMinutesAgo,
          },
        ]);
      }
      return mockDb;
    });

    const result = await controller.listCursors(STITCH_ID);

    expect(result).toHaveLength(1);
    expect(result[0].stale).toBe(true);
    expect(result[0].paused).toBe(false);
    expect(result[0].ageMs).toBeGreaterThan(2 * 30 * 60_000);
    // stateDocument must not be present in the response
    expect(result[0]).not.toHaveProperty('stateDocument');
  });

  it('GET returns stale: false when age is within 2x interval', async () => {
    const now = Date.now();
    const fiveMinutesAgo = new Date(now - 5 * 60_000);

    mockDb.from.mockImplementation((table: unknown) => {
      if (table === integrationStitches) {
        mockDb.where.mockReturnValueOnce(mockDb);
        mockDb.limit.mockResolvedValueOnce([
          { syncIntervalMinutes: 30, scheduleEnabled: true },
        ]);
      } else if (table === syncCursors) {
        mockDb.where.mockResolvedValueOnce([
          {
            id: 'c1',
            stitchId: STITCH_ID,
            streamName: STREAM_NAME,
            createdAt: fiveMinutesAgo,
            updatedAt: fiveMinutesAgo,
          },
        ]);
      }
      return mockDb;
    });

    const result = await controller.listCursors(STITCH_ID);

    expect(result).toHaveLength(1);
    expect(result[0].stale).toBe(false);
    expect(result[0].paused).toBe(false);
    expect(result[0].ageMs).toBeLessThanOrEqual(2 * 30 * 60_000);
  });

  it('GET returns stale: false and paused: true when stitch is paused', async () => {
    const now = Date.now();
    const twoHoursAgo = new Date(now - 120 * 60_000);

    mockDb.from.mockImplementation((table: unknown) => {
      if (table === integrationStitches) {
        mockDb.where.mockReturnValueOnce(mockDb);
        mockDb.limit.mockResolvedValueOnce([
          { syncIntervalMinutes: 30, scheduleEnabled: false },
        ]);
      } else if (table === syncCursors) {
        mockDb.where.mockResolvedValueOnce([
          {
            id: 'c1',
            stitchId: STITCH_ID,
            streamName: STREAM_NAME,
            createdAt: twoHoursAgo,
            updatedAt: twoHoursAgo,
          },
        ]);
      }
      return mockDb;
    });

    const result = await controller.listCursors(STITCH_ID);

    expect(result).toHaveLength(1);
    // Age (120 min) exceeds 2×30 min threshold but stitch is paused — not stale.
    expect(result[0].stale).toBe(false);
    expect(result[0].paused).toBe(true);
  });

  it('GET returns empty array when stitch has no cursors', async () => {
    mockDb.from.mockImplementation((table: unknown) => {
      if (table === integrationStitches) {
        mockDb.where.mockReturnValueOnce(mockDb);
        mockDb.limit.mockResolvedValueOnce([
          { syncIntervalMinutes: 30, scheduleEnabled: true },
        ]);
      } else if (table === syncCursors) {
        mockDb.where.mockResolvedValueOnce([]);
      }
      return mockDb;
    });

    const result = await controller.listCursors(STITCH_ID);

    expect(result).toEqual([]);
  });

  it('GET throws NotFoundException when stitch does not exist', async () => {
    mockDb.select.mockReturnValue(mockDb);
    mockDb.from.mockReturnValue(mockDb);
    mockDb.where.mockReturnValue(mockDb);
    mockDb.limit.mockResolvedValue([]);

    await expect(controller.listCursors(STITCH_ID)).rejects.toThrow(
      NotFoundException,
    );
  });
});
