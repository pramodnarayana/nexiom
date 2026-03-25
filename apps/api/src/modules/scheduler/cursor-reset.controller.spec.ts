import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AuthGuard } from '@nexiom/auth';
import { DATABASE_CONNECTION } from '@nexiom/database';
import { integrationStitches, syncCursors } from '@nexiom/database';
import { SystemAdminGuard } from '../identity/auth/system-admin.guard.js';
import { CursorResetController } from './cursor-reset.controller.js';

const STITCH_ID = '550e8400-e29b-41d4-a716-446655440000';
const STREAM_NAME = 'Account';

const mockCtx = {
  user: { id: 'u1', email: 'admin@example.com' },
} as unknown as import('@nexiom/auth').RequestAuthContext;

function createMockDb() {
  let currentTable: unknown = null;

  const chain = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockImplementation((table: unknown) => {
      currentTable = table;
      return chain;
    }),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    // Expose currentTable for assertions
    getCurrentTable: () => currentTable,
  };
  return chain;
}

type MockDb = ReturnType<typeof createMockDb>;

describe('CursorResetController', () => {
  let controller: CursorResetController;
  let mockDb: MockDb;

  beforeEach(async () => {
    mockDb = createMockDb();

    const module = await Test.createTestingModule({
      controllers: [CursorResetController],
      providers: [{ provide: DATABASE_CONNECTION, useValue: mockDb }],
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

  it('DELETE returns void when row exists', async () => {
    mockDb.delete.mockReturnValue(mockDb);
    mockDb.where.mockResolvedValue(undefined);

    const result = await controller.deleteCursor(
      STITCH_ID,
      STREAM_NAME,
      mockCtx,
    );

    expect(result).toBeUndefined();
    expect(mockDb.delete).toHaveBeenCalledOnce();
    expect(mockDb.where).toHaveBeenCalledOnce();
  });

  it('DELETE is idempotent — no-op when row is absent', async () => {
    mockDb.delete.mockReturnValue(mockDb);
    mockDb.where.mockResolvedValue(undefined);

    await expect(
      controller.deleteCursor(STITCH_ID, STREAM_NAME, mockCtx),
    ).resolves.not.toThrow();
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

    // Table-based dispatch: stitch lookup (integrationStitches) → cursor listing (syncCursors)
    mockDb.from.mockImplementation((table: unknown) => {
      if (table === integrationStitches) {
        mockDb.where.mockReturnValueOnce(mockDb);
        mockDb.limit.mockResolvedValueOnce([{ syncIntervalMinutes: 30 }]);
      } else if (table === syncCursors) {
        mockDb.where.mockResolvedValueOnce([
          {
            id: 'c1',
            stitchId: STITCH_ID,
            streamName: STREAM_NAME,
            stateDocument: {},
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
    expect(result[0].ageMs).toBeGreaterThan(2 * 30 * 60_000);
  });

  it('GET returns stale: false when age is within 2x interval', async () => {
    const now = Date.now();
    const fiveMinutesAgo = new Date(now - 5 * 60_000);

    mockDb.from.mockImplementation((table: unknown) => {
      if (table === integrationStitches) {
        mockDb.where.mockReturnValueOnce(mockDb);
        mockDb.limit.mockResolvedValueOnce([{ syncIntervalMinutes: 30 }]);
      } else if (table === syncCursors) {
        mockDb.where.mockResolvedValueOnce([
          {
            id: 'c1',
            stitchId: STITCH_ID,
            streamName: STREAM_NAME,
            stateDocument: {},
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
    expect(result[0].ageMs).toBeLessThanOrEqual(2 * 30 * 60_000);
  });

  it('GET returns empty array when stitch has no cursors', async () => {
    mockDb.from.mockImplementation((table: unknown) => {
      if (table === integrationStitches) {
        mockDb.where.mockReturnValueOnce(mockDb);
        mockDb.limit.mockResolvedValueOnce([{ syncIntervalMinutes: 30 }]);
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
