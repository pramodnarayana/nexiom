import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { ExceptionService } from './exception.service.js';
import { DATABASE_CONNECTION } from '@nexiom/database';
import { StorageResolverService } from '@nexiom/engine';
import { QueueService, QueueName } from '@nexiom/queue';
import { getLoggerToken } from 'nestjs-pino';

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
};

const ORG_ID = 'org-1';
const STITCH_ID = '11111111-1111-1111-1111-111111111111';
const DEST_CONN = '44444444-4444-4444-4444-444444444444';
const OUTBOUND_ID = '55555555-5555-5555-5555-555555555555';
const TRACE_ID = '66666666-6666-6666-6666-666666666666';

const MOCK_STITCH = {
  id: STITCH_ID,
  orgId: ORG_ID,
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
  updatedAt: new Date('2026-01-02'),
};

function buildSelectChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  chain['from'] = vi.fn().mockReturnValue(chain);
  chain['where'] = vi.fn().mockReturnValue(chain);
  chain['orderBy'] = vi.fn().mockReturnValue(chain);
  chain['limit'] = vi.fn().mockResolvedValue(rows);
  return chain;
}

function buildUpdateChain() {
  const chain: Record<string, unknown> = {};
  chain['set'] = vi.fn().mockReturnValue(chain);
  chain['where'] = vi.fn().mockResolvedValue([]);
  return chain;
}

function buildMockDb(outboundRows: unknown[] = [MOCK_OUTBOUND_ROW]) {
  const selectChain = buildSelectChain(outboundRows);
  const updateChain = buildUpdateChain();
  const tx = {
    execute: vi.fn().mockResolvedValue(undefined),
    select: vi.fn().mockReturnValue(selectChain),
    update: vi.fn().mockReturnValue(updateChain),
  };

  return {
    query: {
      integrationStitches: {
        findMany: vi.fn().mockResolvedValue([MOCK_STITCH]),
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
        {
          provide: getLoggerToken(ExceptionService.name),
          useValue: loggerMock,
        },
      ],
    }).compile();

    service = module.get(ExceptionService);
  });

  describe('listExceptions()', () => {
    it('returns FAIL rows for the org', async () => {
      const result = await service.listExceptions(ORG_ID);
      expect(result.data).toHaveLength(1);
      expect(result.data[0].status).toBe('FAIL');
      expect(result.data[0].id).toBe(OUTBOUND_ID);
    });

    it('returns empty list when org has no stitches', async () => {
      mockDb.query.integrationStitches.findMany = vi.fn().mockResolvedValue([]);
      const result = await service.listExceptions(ORG_ID);
      expect(result.data).toHaveLength(0);
      expect(result.total).toBe(0);
    });

    it('skips connections that cannot be resolved (graceful degradation)', async () => {
      mockResolver.resolveSchemaName = vi
        .fn()
        .mockRejectedValue(new Error('not found'));
      const result = await service.listExceptions(ORG_ID);
      expect(result.data).toHaveLength(0);
    });
  });

  describe('retryException()', () => {
    it('resets status to PENDING and enqueues to DeliveryQueue', async () => {
      const result = await service.retryException(ORG_ID, OUTBOUND_ID);
      expect(result.queued).toBe(true);
      expect(mockQueue.send).toHaveBeenCalledWith(
        QueueName.DeliveryQueue,
        expect.objectContaining({ outboundGatewayId: OUTBOUND_ID }),
      );
    });

    it('throws NotFoundException when outbound row not in org schemas', async () => {
      // Promise.allSettled resolves but all inner queries return empty
      const emptyChain = buildSelectChain([]);
      const tx = {
        execute: vi.fn().mockResolvedValue(undefined),
        select: vi.fn().mockReturnValue(emptyChain),
        update: vi.fn().mockReturnValue(buildUpdateChain()),
      };
      mockDb.transaction = vi
        .fn()
        .mockImplementation((fn: (t: unknown) => Promise<unknown>) => fn(tx));

      await expect(service.retryException(ORG_ID, OUTBOUND_ID)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('dismissException()', () => {
    it('marks the outbound_gateway row as SKIPPED', async () => {
      const result = await service.dismissException(ORG_ID, OUTBOUND_ID);
      expect(result.dismissed).toBe(true);
    });

    it('throws NotFoundException when outbound row not found', async () => {
      const emptyChain = buildSelectChain([]);
      const tx = {
        execute: vi.fn().mockResolvedValue(undefined),
        select: vi.fn().mockReturnValue(emptyChain),
        update: vi.fn().mockReturnValue(buildUpdateChain()),
      };
      mockDb.transaction = vi
        .fn()
        .mockImplementation((fn: (t: unknown) => Promise<unknown>) => fn(tx));

      await expect(
        service.dismissException(ORG_ID, OUTBOUND_ID),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
