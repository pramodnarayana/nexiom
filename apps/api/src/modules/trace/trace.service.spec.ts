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
const STITCH_ID = '11111111-1111-1111-1111-111111111111';
const ORG_ID = 'org-1';
const TRACE_ID = '22222222-2222-2222-2222-222222222222';
const SRC_CONN = '33333333-3333-3333-3333-333333333333';
const DEST_CONN = '44444444-4444-4444-4444-444444444444';

const MOCK_STITCH = {
  id: STITCH_ID,
  orgId: ORG_ID,
  srcConnectionId: SRC_CONN,
  destConnectionId: DEST_CONN,
};

function buildSelectChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  chain['from'] = vi.fn().mockReturnValue(chain);
  chain['where'] = vi.fn().mockReturnValue(chain);
  chain['orderBy'] = vi.fn().mockReturnValue(chain);
  chain['limit'] = vi.fn().mockResolvedValue(rows);
  return chain;
}

function buildMockDb(stitchRow: unknown = MOCK_STITCH) {
  const syncLogRows = [
    {
      layer: 'L1',
      status: 'SUCCESS',
      durationMs: 10,
      routeId: null,
      timestamp: NOW,
    },
  ];

  const listTxSelectChain = buildSelectChain(syncLogRows);
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

    it('throws BadRequestException for invalid cursor', async () => {
      await expect(
        service.listTraces(ORG_ID, STITCH_ID, 50, 'not-a-date'),
      ).rejects.toThrow(BadRequestException);
    });

    it('sets nextCursor when result exceeds limit', async () => {
      const manyRows = Array.from({ length: 6 }, (_, i) => ({
        layer: 'L1',
        status: 'SUCCESS',
        durationMs: i,
        routeId: null,
        timestamp: new Date(Date.now() - i * 1000),
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
    });
  });

  describe('getTrace()', () => {
    it('throws NotFoundException when trace has no sync_log rows', async () => {
      // getTrace() runs 5 parallel transactions via Promise.all.
      // All resolve to [] so layers.length === 0 triggers NotFoundException.
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
  });
});
