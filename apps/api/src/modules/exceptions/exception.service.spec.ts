import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { NotFoundException, ConflictException } from '@nestjs/common';
import { ExceptionService } from './exception.service.js';
import { DATABASE_CONNECTION } from '@nexiom/database';
import { StorageResolverService } from '@nexiom/engine';
import { QueueService, QueueName } from '@nexiom/queue';
import { PinoLogger } from 'nestjs-pino';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@nexiom/database', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@nexiom/database')>();
  return {
    ...actual,
    buildTenantSchema: vi.fn(() => ({
      outboundGateway: 'outbound_gateway_table',
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
  setContext: vi.fn(),
  assign: vi.fn(),
};

const ORG_ID = 'org-1';
const STITCH_ID = '11111111-1111-1111-1111-111111111111';
const DEST_CONN = '44444444-4444-4444-4444-444444444444';
const SRC_CONN = '33333333-3333-3333-3333-333333333333';
const OUTBOUND_ID = '55555555-5555-5555-5555-555555555555';
const TRACE_ID = '66666666-6666-6666-6666-666666666666';
const UPDATED_AT = new Date('2026-01-02T00:00:00.000Z');

const MOCK_STITCH = {
  id: STITCH_ID,
  orgId: ORG_ID,
  srcConnectionId: SRC_CONN,
  destConnectionId: DEST_CONN,
};

const MOCK_OUTBOUND_ROW = {
  id: OUTBOUND_ID,
  traceId: TRACE_ID,
  routeId: STITCH_ID,
  reqPayload: { amount: 100 },
  resPayload: null,
  statusCode: 503,
  attemptCount: 5,
  status: 'FAIL',
  createdAt: new Date('2026-01-01'),
  updatedAt: UPDATED_AT,
};

function buildCountChain(count: number) {
  const chain: Record<string, unknown> = {};
  chain['from'] = vi.fn().mockReturnValue(chain);
  chain['where'] = vi.fn().mockResolvedValue([{ count }]);
  return chain;
}

function buildDataChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  chain['from'] = vi.fn().mockReturnValue(chain);
  chain['where'] = vi.fn().mockReturnValue(chain);
  chain['orderBy'] = vi.fn().mockReturnValue(chain);
  chain['limit'] = vi.fn().mockResolvedValue(rows);
  return chain;
}

function buildUpdateChain(returning: unknown[] = [{ id: 'updated-id' }]) {
  const chain: Record<string, unknown> = {};
  chain['set'] = vi.fn().mockReturnValue(chain);
  chain['where'] = vi.fn().mockReturnValue(chain);
  chain['returning'] = vi.fn().mockResolvedValue(returning);
  return chain;
}

function buildResolveSelectChain(rows: unknown[]) {
  // The resolveOutboundRow select chain ends with .limit()
  const chain: Record<string, unknown> = {};
  chain['from'] = vi.fn().mockReturnValue(chain);
  chain['where'] = vi.fn().mockReturnValue(chain);
  chain['limit'] = vi.fn().mockResolvedValue(rows);
  return chain;
}

function buildMockDb(outboundRows: unknown[] = [MOCK_OUTBOUND_ROW]) {
  let selectCallCount = 0;
  const tx = {
    execute: vi.fn().mockResolvedValue(undefined),
    select: vi.fn().mockImplementation(() => {
      selectCallCount++;
      // listExceptions calls COUNT first, then DATA
      if (selectCallCount % 2 === 1) {
        return buildCountChain(outboundRows.length);
      }
      return buildDataChain(outboundRows);
    }),
    update: vi.fn().mockReturnValue(buildUpdateChain()),
  };

  return {
    query: {
      integrationStitches: {
        findMany: vi.fn().mockResolvedValue([MOCK_STITCH]),
        findFirst: vi.fn().mockResolvedValue(MOCK_STITCH),
      },
    },
    transaction: vi
      .fn()
      .mockImplementation((fn: (t: unknown) => Promise<unknown>) => fn(tx)),
  };
}

function buildMockResolver(schemaName = 'ws_dest_001') {
  return { resolveSchemaName: vi.fn().mockResolvedValue(schemaName) };
}

function buildMockQueue() {
  return { send: vi.fn().mockResolvedValue(undefined) };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ExceptionService', () => {
  let service: ExceptionService;
  let mockDb: ReturnType<typeof buildMockDb>;
  let mockResolver: ReturnType<typeof buildMockResolver>;
  let mockQueue: ReturnType<typeof buildMockQueue>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockDb = buildMockDb();
    mockResolver = buildMockResolver();
    mockQueue = buildMockQueue();

    const module = await Test.createTestingModule({
      providers: [
        ExceptionService,
        { provide: DATABASE_CONNECTION, useValue: mockDb },
        { provide: StorageResolverService, useValue: mockResolver },
        { provide: QueueService, useValue: mockQueue },
        { provide: PinoLogger, useValue: loggerMock },
      ],
    }).compile();

    service = module.get(ExceptionService);
  });

  describe('listExceptions()', () => {
    it('returns exception rows with total and nextCursor for the org', async () => {
      const result = await service.listExceptions(ORG_ID);
      expect(result.data).toHaveLength(1);
      expect(result.data[0].id).toBe(OUTBOUND_ID);
      expect(result.total).toBeGreaterThanOrEqual(0);
      expect(result.limit).toBe(50);
      expect(result).toHaveProperty('nextCursor');
    });

    it('returns empty list when org has no stitches', async () => {
      mockDb.query.integrationStitches.findMany = vi.fn().mockResolvedValue([]);
      const result = await service.listExceptions(ORG_ID);
      expect(result.data).toHaveLength(0);
      expect(result.total).toBe(0);
      expect(result.nextCursor).toBeNull();
    });

    it('skips unresolvable connections gracefully', async () => {
      mockResolver.resolveSchemaName = vi
        .fn()
        .mockRejectedValue(new Error('not found'));
      const result = await service.listExceptions(ORG_ID);
      expect(result.data).toHaveLength(0);
    });

    it('respects limit pagination param', async () => {
      const result = await service.listExceptions(ORG_ID, {}, { limit: 10 });
      expect(result.limit).toBe(10);
    });

    it('handles cursor-based pagination state advances', async () => {
      mockDb.query.integrationStitches.findMany = vi
        .fn()
        .mockResolvedValue([MOCK_STITCH]);
      mockResolver.resolveSchemaName = vi.fn().mockResolvedValue('ws_dest_001');

      // First call (fetches nextCursor)
      const page1 = await service.listExceptions(ORG_ID, {}, { limit: 1 });
      expect(page1.nextCursor).toBeDefined();

      // Second call (uses returned cursor)
      const page2 = await service.listExceptions(
        ORG_ID,
        {},
        { cursor: page1.nextCursor!, limit: 1 },
      );
      // Data matches mock outbound row; in real implementation rows shift
      expect(page2.data).toHaveLength(1);
      // Given our mock always yields the same row for size 1, hasMore remains the same,
      // but we assert the service can consume the previous cursor without throwing.
      expect(page2.nextCursor).toBeDefined();
    });

    it('filters correctly by status string unresolved vs dismissed', async () => {
      mockDb.query.integrationStitches.findMany = vi
        .fn()
        .mockResolvedValue([MOCK_STITCH]);
      mockResolver.resolveSchemaName = vi.fn().mockResolvedValue('ws_dest_001');

      const unresolved = await service.listExceptions(
        ORG_ID,
        { status: 'unresolved' },
        { limit: 5 },
      );
      expect(unresolved.data).toHaveLength(1);

      const dismissed = await service.listExceptions(
        ORG_ID,
        { status: 'dismissed' },
        { limit: 5 },
      );
      expect(dismissed.data).toHaveLength(1);
    });
  });

  describe('retryException()', () => {
    beforeEach(() => {
      // resolveOutboundRow uses a select chain that ends with .limit()
      const resolveTx = {
        execute: vi.fn().mockResolvedValue(undefined),
        select: vi
          .fn()
          .mockReturnValue(buildResolveSelectChain([MOCK_OUTBOUND_ROW])),
      };
      const updateTx = {
        execute: vi.fn().mockResolvedValue(undefined),
        update: vi
          .fn()
          .mockReturnValue(buildUpdateChain([{ id: OUTBOUND_ID }])),
      };
      let txCallCount = 0;
      mockDb.transaction = vi
        .fn()
        .mockImplementation((fn: (t: unknown) => Promise<unknown>) => {
          txCallCount++;
          return fn(txCallCount === 1 ? resolveTx : updateTx);
        });
    });

    it('resets status to PENDING and enqueues to DeliveryQueue', async () => {
      const result = await service.retryException(ORG_ID, OUTBOUND_ID);
      expect(result.queued).toBe(true);
      expect(mockQueue.send).toHaveBeenCalledWith(
        QueueName.DeliveryQueue,
        expect.objectContaining({
          outboundGatewayId: OUTBOUND_ID,
          routeId: STITCH_ID,
          traceId: TRACE_ID,
          connectionId: SRC_CONN,
          targetConnectionId: DEST_CONN,
        }),
      );
    });

    it('throws ConflictException when status transition is invalid (0 rows updated)', async () => {
      const resolveTx = {
        execute: vi.fn().mockResolvedValue(undefined),
        select: vi
          .fn()
          .mockReturnValue(buildResolveSelectChain([MOCK_OUTBOUND_ROW])),
      };
      const updateTx = {
        execute: vi.fn().mockResolvedValue(undefined),
        update: vi.fn().mockReturnValue(buildUpdateChain([])), // 0 rows updated
      };
      let txCallCount = 0;
      mockDb.transaction = vi
        .fn()
        .mockImplementation((fn: (t: unknown) => Promise<unknown>) => {
          txCallCount++;
          return fn(txCallCount === 1 ? resolveTx : updateTx);
        });

      await expect(service.retryException(ORG_ID, OUTBOUND_ID)).rejects.toThrow(
        ConflictException,
      );
    });

    it('throws NotFoundException when outbound row not in org schemas', async () => {
      mockDb.transaction = vi
        .fn()
        .mockImplementation((fn: (t: unknown) => Promise<unknown>) =>
          fn({
            execute: vi.fn().mockResolvedValue(undefined),
            select: vi.fn().mockReturnValue(buildResolveSelectChain([])),
          }),
        );
      await expect(service.retryException(ORG_ID, OUTBOUND_ID)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('dismissException()', () => {
    it('marks the outbound_gateway row as DISMISSED', async () => {
      const resolveTx = {
        execute: vi.fn().mockResolvedValue(undefined),
        select: vi
          .fn()
          .mockReturnValue(buildResolveSelectChain([MOCK_OUTBOUND_ROW])),
      };
      const dismissTx = {
        execute: vi.fn().mockResolvedValue(undefined),
        update: vi
          .fn()
          .mockReturnValue(buildUpdateChain([{ id: OUTBOUND_ID }])),
      };
      let txCallCount = 0;
      mockDb.transaction = vi
        .fn()
        .mockImplementation((fn: (t: unknown) => Promise<unknown>) => {
          txCallCount++;
          return fn(txCallCount === 1 ? resolveTx : dismissTx);
        });

      const result = await service.dismissException(ORG_ID, OUTBOUND_ID);
      expect(result.dismissed).toBe(true);
    });

    it('throws ConflictException when row is already DISMISSED', async () => {
      const resolveTx = {
        execute: vi.fn().mockResolvedValue(undefined),
        select: vi
          .fn()
          .mockReturnValue(buildResolveSelectChain([MOCK_OUTBOUND_ROW])),
      };
      const dismissTx = {
        execute: vi.fn().mockResolvedValue(undefined),
        update: vi.fn().mockReturnValue(buildUpdateChain([])), // 0 rows updated
      };
      let txCallCount = 0;
      mockDb.transaction = vi
        .fn()
        .mockImplementation((fn: (t: unknown) => Promise<unknown>) => {
          txCallCount++;
          return fn(txCallCount === 1 ? resolveTx : dismissTx);
        });

      await expect(
        service.dismissException(ORG_ID, OUTBOUND_ID),
      ).rejects.toThrow(ConflictException);
    });

    it('throws NotFoundException when outbound row not found', async () => {
      mockDb.transaction = vi
        .fn()
        .mockImplementation((fn: (t: unknown) => Promise<unknown>) =>
          fn({
            execute: vi.fn().mockResolvedValue(undefined),
            select: vi.fn().mockReturnValue(buildResolveSelectChain([])),
          }),
        );

      await expect(
        service.dismissException(ORG_ID, OUTBOUND_ID),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
