import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test } from '@nestjs/testing';
import {
  DATABASE_CONNECTION,
  integrationStitches,
  appConnections,
  syncCursors,
} from '@nexiom/database';
import { REDIS_CLIENT } from '@nexiom/cache';
import { TokenManagerService } from '@nexiom/connectors';
import { CursorManagerService } from '@nexiom/engine';
import type { StreamDescriptor, PollPage, PollRecord } from '@nexiom/engine';
import { PieceRegistryService } from '../trigger/piece-registry.service.js';
import { SyncRunner } from './sync-runner.js';
import { PollSyncRunner } from './poll-sync-runner.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const STITCH_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const CONN_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

const STITCH = {
  id: STITCH_ID,
  srcConnectionId: CONN_ID,
  sourceObject: 'Account',
  syncIntervalMinutes: 30,
  lastScheduledAt: null,
};

const CONNECTION = { id: CONN_ID, appName: 'salesforce' };

const CREDENTIALS = {
  clientId: 'cid',
  clientSecret: 'sec',
  accessToken: 'tok',
  data: { instance_url: 'https://example.my.salesforce.com' },
};

const TS_DESCRIPTOR: StreamDescriptor = {
  streamName: 'Account',
  replicationMethod: 'INCREMENTAL',
  replicationKey: 'UpdatedAt',
  replicationKeyType: 'timestamp',
  keyProperties: ['Id'],
};

function makeRecord(value: string): PollRecord {
  return { data: {}, replicationKey: 'UpdatedAt', replicationKeyValue: value };
}

function makePage(
  records: PollRecord[],
  nextCursor?: Record<string, unknown>,
): PollPage {
  return { streamName: 'Account', records, nextPageCursor: nextCursor };
}

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

function makeDb(
  overrides: {
    stitch?: typeof STITCH | null;
    connection?: typeof CONNECTION | null;
    stateDoc?: object | null;
  } = {},
) {
  const {
    stitch = STITCH,
    connection = CONNECTION,
    stateDoc = null,
  } = overrides;

  // Track the last table passed to .from() so limit() can return the right fixture
  // regardless of query order — avoids fragile call-count dispatch.
  let currentTable: unknown;

  const builder = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockImplementation((table: unknown) => {
      currentTable = table;
      return builder;
    }),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockImplementation(() => {
      if (currentTable === integrationStitches)
        return Promise.resolve(stitch ? [stitch] : []);
      if (currentTable === appConnections)
        return Promise.resolve(connection ? [connection] : []);
      if (currentTable === syncCursors)
        return Promise.resolve(stateDoc ? [{ stateDocument: stateDoc }] : []);
      return Promise.resolve([]);
    }),
    values: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
  };

  return builder;
}

function makeRedis(lockGranted = true) {
  return {
    set: vi.fn().mockResolvedValue(lockGranted ? 'OK' : null),
    eval: vi.fn().mockResolvedValue(1),
  };
}

function makePiece(pages: PollPage[], descriptors?: StreamDescriptor[]) {
  return {
    name: 'salesforce',
    describeStreams: descriptors
      ? vi.fn().mockResolvedValue(descriptors)
      : undefined,
    poll: vi
      .fn()
      .mockImplementation(() => Promise.resolve(pages.shift() ?? makePage([]))),
  };
}

function makeCursorManager() {
  return new CursorManagerService({
    get: () => undefined,
  } as never);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PollSyncRunner', () => {
  let runner: PollSyncRunner;
  let db: ReturnType<typeof makeDb>;
  let redis: ReturnType<typeof makeRedis>;
  let tokenManager: { getValidCredentials: ReturnType<typeof vi.fn> };
  let pieceRegistry: { getPiece: ReturnType<typeof vi.fn> };
  let cursorManager: CursorManagerService;

  async function build(
    overrides: {
      db?: ReturnType<typeof makeDb>;
      redis?: ReturnType<typeof makeRedis>;
      piece?: ReturnType<typeof makePiece>;
    } = {},
  ) {
    db = overrides.db ?? makeDb();
    redis = overrides.redis ?? makeRedis();
    tokenManager = {
      getValidCredentials: vi.fn().mockResolvedValue(CREDENTIALS),
    };
    const piece =
      overrides.piece ??
      makePiece([makePage([makeRecord('2026-01-01T00:00:00.000Z')])]);
    pieceRegistry = { getPiece: vi.fn().mockReturnValue(piece) };
    cursorManager = makeCursorManager();

    const module = await Test.createTestingModule({
      providers: [
        { provide: SyncRunner, useClass: PollSyncRunner },
        { provide: DATABASE_CONNECTION, useValue: db },
        { provide: REDIS_CLIENT, useValue: redis },
        { provide: TokenManagerService, useValue: tokenManager },
        { provide: PieceRegistryService, useValue: pieceRegistry },
        { provide: CursorManagerService, useValue: cursorManager },
      ],
    }).compile();

    runner = module.get(SyncRunner);
  }

  beforeEach(async () => {
    await build();
  });

  // ── Happy path ─────────────────────────────────────────────────────────────

  it('returns succeeded with one streamResult on a single-page run', async () => {
    const result = await runner.run(STITCH_ID);

    expect(result.status).toBe('succeeded');
    expect(result.stitchId).toBe(STITCH_ID);
    expect(result.streamResults).toHaveLength(1);
    expect(result.streamResults![0].status).toBe('succeeded');
    expect(result.streamResults![0].streamName).toBe('Account');
    expect(result.streamResults![0].recordsIngested).toBe(1);
  });

  it('uses describeStreams to resolve the descriptor when available', async () => {
    const piece = makePiece(
      [makePage([makeRecord('2026-01-01T00:00:00.000Z')])],
      [TS_DESCRIPTOR],
    );
    await build({ piece });

    await runner.run(STITCH_ID);

    expect(piece.describeStreams).toHaveBeenCalledWith(CREDENTIALS);
  });

  it('falls back to FULL_TABLE descriptor when describeStreams is absent', async () => {
    const piece = {
      name: 'salesforce',
      poll: vi.fn().mockResolvedValue(makePage([])),
    };
    pieceRegistry.getPiece.mockReturnValue(piece);

    const result = await runner.run(STITCH_ID);

    expect(result.status).toBe('succeeded');
    expect(piece.poll).toHaveBeenCalled();
  });

  it('falls back to FULL_TABLE when describeStreams returns no match for sourceObject', async () => {
    const piece = makePiece(
      [makePage([])],
      [
        {
          streamName: 'Contact',
          replicationMethod: 'INCREMENTAL',
          replicationKey: 'Id',
          replicationKeyType: 'numeric' as const,
          keyProperties: ['Id'],
        },
      ],
    );
    await build({ piece });
    const result = await runner.run(STITCH_ID);
    expect(result.status).toBe('succeeded');
  });

  it('accumulates records across multiple pages', async () => {
    const piece = makePiece([
      makePage(
        [
          makeRecord('2026-01-01T00:00:00.000Z'),
          makeRecord('2026-01-02T00:00:00.000Z'),
        ],
        { after: 'page1' },
      ),
      makePage([makeRecord('2026-01-03T00:00:00.000Z')]),
    ]);
    await build({ piece });

    const result = await runner.run(STITCH_ID);

    expect(result.streamResults![0].recordsIngested).toBe(3);
    expect(piece.poll).toHaveBeenCalledTimes(2);
  });

  it('updates last_scheduled_at on the stitch after a successful run', async () => {
    await runner.run(STITCH_ID);

    expect(db.update).toHaveBeenCalled();
    expect(db.set).toHaveBeenCalledWith(
      expect.objectContaining({
        lastScheduledAt: expect.any(Date) as unknown as Date,
      }),
    );
  });

  // ── Lock handling ──────────────────────────────────────────────────────────

  it('returns skipped when the Redis lock is unavailable', async () => {
    await build({ redis: makeRedis(false) });

    const result = await runner.run(STITCH_ID);

    expect(result.status).toBe('skipped');
    expect(result.streamResults![0].status).toBe('skipped');
    // last_scheduled_at must NOT be bumped on a skipped run
    expect(db.update).not.toHaveBeenCalled();
  });

  it('releases the lock in the finally block even when poll throws', async () => {
    const piece = {
      name: 'salesforce',
      poll: vi.fn().mockRejectedValue(new Error('vendor timeout')),
    };
    pieceRegistry.getPiece.mockReturnValue(piece);

    const result = await runner.run(STITCH_ID);

    // Top-level status propagates the stream failure
    expect(result.status).toBe('failed');
    expect(result.streamResults![0].status).toBe('failed');
    expect(result.streamResults![0].error).toContain('vendor timeout');
    expect(redis.eval).toHaveBeenCalled(); // lock released
    // last_scheduled_at must NOT be bumped on a failed run
    expect(db.update).not.toHaveBeenCalled();
  });

  // ── Crash-resume ───────────────────────────────────────────────────────────

  it('resumes from bookmark.offset when currently_syncing is set (crash-resume)', async () => {
    const crashedState = {
      bookmarks: {
        Account: {
          replication_key: 'UpdatedAt',
          replication_key_value: '2026-01-01T00:00:00.000Z',
          replication_key_type: 'timestamp',
          offset: { after: 'cursor-page-3' },
        },
      },
      versions: {},
      currently_syncing: 'Account',
    };
    const dbWithCrash = makeDb({ stateDoc: crashedState });
    await build({ db: dbWithCrash });

    const result = await runner.run(STITCH_ID);

    // poll called with the crash offset as nextPageCursor
    const piece = pieceRegistry.getPiece('salesforce') as ReturnType<
      typeof makePiece
    >;
    expect(piece.poll).toHaveBeenCalledWith(
      CREDENTIALS,
      'Account',
      expect.anything(),
      { after: 'cursor-page-3' },
    );
    expect(result.status).toBe('succeeded');
  });

  // ── Error paths ────────────────────────────────────────────────────────────

  it('throws when the stitch does not exist', async () => {
    const noStitch = makeDb({ stitch: null });
    await build({ db: noStitch });

    await expect(runner.run(STITCH_ID)).rejects.toThrow(
      `Stitch not found: ${STITCH_ID}`,
    );
  });

  it('throws when the connection does not exist', async () => {
    const noConn = makeDb({ connection: null });
    await build({ db: noConn });

    await expect(runner.run(STITCH_ID)).rejects.toThrow(
      `Connection not found: ${CONN_ID}`,
    );
  });

  it('throws when the piece is not registered', async () => {
    pieceRegistry.getPiece.mockReturnValue(undefined);

    await expect(runner.run(STITCH_ID)).rejects.toThrow(
      'Piece not registered: "salesforce"',
    );
  });

  it('throws when the piece does not support poll()', async () => {
    pieceRegistry.getPiece.mockReturnValue({ name: 'salesforce' });

    await expect(runner.run(STITCH_ID)).rejects.toThrow(
      'does not support polling',
    );
  });
});
