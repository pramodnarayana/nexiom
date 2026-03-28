import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { TraceService } from './trace.service.js';
import { DATABASE_CONNECTION } from '@nexiom/database';
import { StorageResolverService } from '@nexiom/engine';
import { getLoggerToken } from 'nestjs-pino';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@nexiom/database', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@nexiom/database')>();
  return {
    ...actual,
    buildTenantSchema: vi.fn(() => ({
      syncLog: 'syncLog_table',
      inboundGateway: 'inboundGateway_table',
      replicaEntity: 'replicaEntity_table',
      normalizedEntity: 'normalizedEntity_table',
      outboundGateway: 'outboundGateway_table',
    })),
    assertValidSchemaName: vi.fn(),
  };
});

const loggerMock = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  log: vi.fn(),
};

const NOW = new Date('2026-01-01T12:00:00Z');
const NOW_MINUS_1 = new Date('2026-01-01T11:59:00Z');
const STITCH_ID = '11111111-1111-1111-1111-111111111111';
const ORG_ID = 'org-1';
const TRACE_ID = '22222222-2222-2222-2222-222222222222';
const SRC_CONN = '33333333-3333-3333-3333-333333333333';
const DEST_CONN = '44444444-4444-4444-4444-444444444444';
const ROW_ID_1 = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ROW_ID_2 = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

const MOCK_STITCH = {
  id: STITCH_ID,
  orgId: ORG_ID,
  srcConnectionId: SRC_CONN,
  destConnectionId: DEST_CONN,
};

// Captures the arguments passed to from()/where()/orderBy() so tests can
// assert that the service queries the correct table with the correct predicates.
interface CallCapture {
  fromArgs: unknown[];
  whereArgs: unknown[][];
  orderByArgs: unknown[][];
}

function buildSelectChain(rows: unknown[], capture?: CallCapture) {
  const chain: Record<string, unknown> = {};
  chain['from'] = vi.fn().mockImplementation((...args: unknown[]) => {
    capture?.fromArgs.push(args[0]);
    return chain;
  });
  chain['where'] = vi.fn().mockImplementation((...args: unknown[]) => {
    capture?.whereArgs.push(args);
    return chain;
  });
  chain['orderBy'] = vi.fn().mockImplementation((...args: unknown[]) => {
    capture?.orderByArgs.push(args);
    return chain;
  });
  chain['limit'] = vi.fn().mockResolvedValue(rows);
  return chain;
}

function buildMockDb(stitchRow: unknown = MOCK_STITCH, txRows: unknown[] = []) {
  const syncLogRows = [
    {
      id: ROW_ID_1,
      traceId: TRACE_ID,
      layer: 'L1',
      status: 'SUCCESS',
      durationMs: 10,
      routeId: STITCH_ID,
      timestamp: NOW,
    },
  ];

  const capture: CallCapture = { fromArgs: [], whereArgs: [], orderByArgs: [] };
  const listTxSelectChain = buildSelectChain(
    txRows.length > 0 ? txRows : syncLogRows,
    capture,
  );
  const listTx = {
    execute: vi.fn().mockResolvedValue(undefined),
    select: vi.fn().mockReturnValue(listTxSelectChain),
  };

  return {
    query: {
      integrationStitches: {
        findFirst: vi.fn().mockResolvedValue(stitchRow),
      },
    },
    transaction: vi
      .fn()
      .mockImplementation((fn: (t: unknown) => Promise<unknown>) => fn(listTx)),
    _capture: capture,
  };
}

function buildMockStorageResolver(schemaName = 'ws_sf_001') {
  return {
    resolveSchemaName: vi.fn().mockResolvedValue(schemaName),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TraceService', () => {
  let service: TraceService;
  let mockDb: ReturnType<typeof buildMockDb>;
  let mockResolver: ReturnType<typeof buildMockStorageResolver>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockDb = buildMockDb();
    mockResolver = buildMockStorageResolver();

    const module = await Test.createTestingModule({
      providers: [
        TraceService,
        { provide: DATABASE_CONNECTION, useValue: mockDb },
        { provide: StorageResolverService, useValue: mockResolver },
        { provide: getLoggerToken(TraceService.name), useValue: loggerMock },
      ],
    }).compile();

    service = module.get(TraceService);
  });

  describe('listTraces()', () => {
    it('returns paginated sync_log rows for the stitch', async () => {
      const result = await service.listTraces(ORG_ID, STITCH_ID, 50);
      expect(result.data).toHaveLength(1);
      expect(result.data[0].layer).toBe('L1');
      expect(result.data[0].routeId).toBe(STITCH_ID);
      expect(result.nextCursor).toBeNull();
    });

    it('throws NotFoundException when stitch not found', async () => {
      mockDb.query.integrationStitches.findFirst = vi
        .fn()
        .mockResolvedValue(null);
      await expect(service.listTraces(ORG_ID, STITCH_ID, 50)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws BadRequestException for invalid composite cursor', async () => {
      // cursor must have the format "<ISO>:<uuid>"
      await expect(
        service.listTraces(ORG_ID, STITCH_ID, 50, 'not-a-valid-cursor'),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when cursor timestamp is invalid', async () => {
      await expect(
        service.listTraces(ORG_ID, STITCH_ID, 50, `not-a-date:${STITCH_ID}`),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when cursor id is invalid UUID', async () => {
      await expect(
        service.listTraces(
          ORG_ID,
          STITCH_ID,
          50,
          `${NOW.toISOString()}:not-a-uuid`,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('sets nextCursor (composite timestamp:id) when result exceeds limit', async () => {
      // Produce 6 rows so that limit=5 triggers hasMore=true
      const manyRows = Array.from({ length: 6 }, (_, i) => ({
        id: `${ROW_ID_1.slice(0, -1)}${i}`,
        traceId: TRACE_ID,
        layer: 'L1',
        status: 'SUCCESS' as const,
        durationMs: i,
        routeId: STITCH_ID,
        timestamp: new Date(NOW.getTime() - i * 1000),
      }));
      const chain = buildSelectChain(manyRows);
      const tx = {
        execute: vi.fn().mockResolvedValue(undefined),
        select: vi.fn().mockReturnValue(chain),
      };
      mockDb.transaction = vi
        .fn()
        .mockImplementation((fn: (t: unknown) => Promise<unknown>) => fn(tx));

      const result = await service.listTraces(ORG_ID, STITCH_ID, 5);
      expect(result.data).toHaveLength(5);
      expect(result.nextCursor).not.toBeNull();
      // Composite cursor: "<ISO>:<uuid>"
      expect(result.nextCursor).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z:.+-/);
    });

    it('accepts a valid composite cursor without throwing', async () => {
      const validCursor = `${NOW_MINUS_1.toISOString()}:${ROW_ID_2}`;
      // Should not throw — cursor is valid
      await expect(
        service.listTraces(ORG_ID, STITCH_ID, 50, validCursor),
      ).resolves.toBeDefined();
    });
  });

  describe('getTrace()', () => {
    it('throws NotFoundException when trace has no sync_log rows for this stitch', async () => {
      // All 5 parallel transactions return [] — layers.length === 0 → 404
      mockDb.transaction = vi.fn().mockResolvedValue([]);
      await expect(
        service.getTrace(ORG_ID, STITCH_ID, TRACE_ID),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when stitch is not in org', async () => {
      mockDb.query.integrationStitches.findFirst = vi
        .fn()
        .mockResolvedValue(null);
      await expect(
        service.getTrace(ORG_ID, STITCH_ID, TRACE_ID),
      ).rejects.toThrow(NotFoundException);
    });

    it('resolves parallel schema resolution for src and dest', async () => {
      // getTrace calls resolveSchemaName twice (src + dest) in parallel
      mockDb.transaction = vi.fn().mockResolvedValue([]);
      await expect(
        service.getTrace(ORG_ID, STITCH_ID, TRACE_ID),
      ).rejects.toThrow();
      expect(mockResolver.resolveSchemaName).toHaveBeenCalledWith(SRC_CONN);
      expect(mockResolver.resolveSchemaName).toHaveBeenCalledWith(DEST_CONN);
    });
  });
});
