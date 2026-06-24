/* eslint-disable @typescript-eslint/require-await */
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { DATABASE_CONNECTION } from '@soopa/database';
import { DB_MANAGER } from '@soopa/dbmanager';
import { REDIS_CLIENT } from '@soopa/cache';
import { TokenManagerService } from '@soopa/credentials';
import { PieceRegistryService } from '@soopa/piece-registry';
import { CursorManagerService, StorageResolverService } from '@soopa/pipeline';
import { ConnectionSyncRunner } from './connection-sync-runner.js';
import { BadRequestException } from '@nestjs/common';
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('ConnectionSyncRunner', () => {
  let runner: ConnectionSyncRunner;
  let dbMock: Record<string, ReturnType<typeof vi.fn>>;
  let dbManagerMock: Record<string, ReturnType<typeof vi.fn>>;
  let redisMock: Record<string, ReturnType<typeof vi.fn>>;
  let configMock: Record<string, ReturnType<typeof vi.fn>>;
  let tokenManagerMock: Record<string, ReturnType<typeof vi.fn>>;
  let pieceRegistryMock: Record<string, ReturnType<typeof vi.fn>>;
  let cursorManagerMock: Record<string, unknown>;
  let storageResolverMock: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(async () => {
    dbMock = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi
        .fn()
        .mockResolvedValue([
          { id: 'conn-1', appName: 'test-app', orgId: 'org-1' },
        ]),
    };

    let traceIdCounter = 0;
    dbManagerMock = {
      applyPlan: vi.fn().mockResolvedValue(undefined),
      getTenantDb: vi.fn().mockResolvedValue({
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([]),
        insert: vi.fn().mockReturnThis(),
        values: vi.fn().mockReturnThis(),
        onConflictDoUpdate: vi.fn().mockResolvedValue({}),
        transaction: vi
          .fn()
          .mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => {
            let lastInsertedCount = 0;
            const tx = {
              execute: vi.fn(),
              insert: vi.fn().mockReturnThis(),
              values: vi.fn().mockImplementation((rows: unknown[]) => {
                lastInsertedCount = Array.isArray(rows) ? rows.length : 1;
                return tx;
              }),
              onConflictDoNothing: vi.fn().mockReturnThis(),
              onConflictDoUpdate: vi.fn().mockReturnThis(),
              returning: vi.fn().mockImplementation(() => {
                const startIndex = traceIdCounter;
                traceIdCounter += lastInsertedCount;
                return Promise.resolve(
                  Array.from({ length: lastInsertedCount }, (_, i) => ({
                    traceId: `trace-${startIndex + i}`,
                  })),
                );
              }),
            };
            return await cb(tx);
          }),
      }),
    };

    redisMock = {
      set: vi.fn().mockResolvedValue('OK'),
      eval: vi.fn().mockResolvedValue(1),
    };

    configMock = {
      get: vi.fn().mockReturnValue('id'),
    };

    tokenManagerMock = {
      getValidCredentials: vi.fn().mockResolvedValue({ access_token: 'test' }),
    };

    pieceRegistryMock = {
      getPiece: vi.fn().mockReturnValue({
        describeStreams: vi
          .fn()
          .mockResolvedValue([
            { streamName: 'test-stream', replicationMethod: 'FULL_TABLE' },
          ]),
        poll: vi
          .fn()
          .mockResolvedValue({ records: [], nextPageCursor: undefined }),
      }),
    };

    cursorManagerMock = {
      calculateWindow: vi.fn().mockReturnValue({}),
      trackHighWaterMark: vi.fn().mockReturnValue('1'),
      checkpointInterval: 100,
    };

    storageResolverMock = {
      resolveSchemaName: vi.fn().mockResolvedValue('ws_123'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConnectionSyncRunner,
        { provide: DATABASE_CONNECTION, useValue: dbMock },
        { provide: DB_MANAGER, useValue: dbManagerMock },
        { provide: REDIS_CLIENT, useValue: redisMock },
        { provide: ConfigService, useValue: configMock },
        { provide: TokenManagerService, useValue: tokenManagerMock },
        { provide: PieceRegistryService, useValue: pieceRegistryMock },
        { provide: CursorManagerService, useValue: cursorManagerMock },
        { provide: StorageResolverService, useValue: storageResolverMock },
      ],
    }).compile();

    runner = module.get<ConnectionSyncRunner>(ConnectionSyncRunner);
  });

  it('should be defined', () => {
    expect(runner).toBeDefined();
  });

  it('should run a successful sync', async () => {
    const result = await runner.run('conn-1', 'test-stream');
    expect(result.status).toBe('succeeded');
    expect(result.streamResults).toBeDefined();
    expect(result.streamResults![0].status).toBe('succeeded');
  });

  it('should run all streams if objectType is not provided', async () => {
    const result = await runner.run('conn-1');
    expect(result.status).toBe('succeeded');
    expect(result.streamResults?.length).toBeGreaterThan(0);
  });

  it('should return failed status if objectType not provided and describeStreams missing', async () => {
    pieceRegistryMock.getPiece.mockReturnValue({
      poll: vi.fn(),
    });
    const result = await runner.run('conn-1');
    expect(result.status).toBe('failed');
    expect(result.streamResults).toEqual([]);
  });

  it('should handle pagination and checkpoint intervals', async () => {
    cursorManagerMock.checkpointInterval = 2;
    pieceRegistryMock.getPiece.mockReturnValue({
      describeStreams: vi
        .fn()
        .mockResolvedValue([
          { streamName: 'test-stream', replicationMethod: 'FULL_TABLE' },
        ]),
      poll: vi
        .fn()
        .mockResolvedValueOnce({
          records: [{ data: { id: '1' } }],
          nextPageCursor: { cursor: '2' },
        })
        .mockResolvedValueOnce({
          records: [{ data: { id: '2' } }],
          nextPageCursor: { cursor: '3' },
        })
        .mockResolvedValueOnce({
          records: [{ data: { id: '3' } }],
          nextPageCursor: undefined,
        }),
    });

    const result = await runner.run('conn-1', 'test-stream');
    expect(result.streamResults![0].recordsIngested).toBe(3);
    expect(dbManagerMock.getTenantDb).toHaveBeenCalled();
  });

  it('should abort if lock is stolen during pagination', async () => {
    redisMock.eval.mockResolvedValueOnce(1).mockResolvedValueOnce(0); // first renew succeeds, second fails
    pieceRegistryMock.getPiece.mockReturnValue({
      describeStreams: vi
        .fn()
        .mockResolvedValue([
          { streamName: 'test-stream', replicationMethod: 'FULL_TABLE' },
        ]),
      poll: vi
        .fn()
        .mockResolvedValueOnce({
          records: [{ data: { id: '1' } }],
          nextPageCursor: { cursor: '2' },
        })
        .mockResolvedValueOnce({
          records: [{ data: { id: '2' } }],
          nextPageCursor: undefined,
        }),
    });

    const result = await runner.run('conn-1', 'test-stream');
    expect(result.streamResults![0].status).toBe('failed');
    expect(result.streamResults![0].error).toMatch(/Lock stolen for stream/);
  });

  it('should handle crash resume logic', async () => {
    // Mock the state doc to trigger crash resume
    dbManagerMock.getTenantDb.mockResolvedValue({
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([
        {
          stateDocument: {
            bookmarks: {
              'test-stream': {
                offset: { cursor: '123' },
                replication_key: '',
                replication_key_value: '',
                replication_key_type: 'opaque',
              },
            },
            versions: {},
            currently_syncing: 'test-stream',
          },
        },
      ]),
      insert: vi.fn().mockReturnThis(),
      values: vi.fn().mockReturnThis(),
      onConflictDoUpdate: vi.fn().mockResolvedValue({}),
      transaction: vi.fn().mockImplementation(async (cb) => {
        const tx = {
          execute: vi.fn(),
          insert: vi.fn().mockReturnThis(),
          values: vi.fn().mockReturnThis(),
          onConflictDoNothing: vi.fn().mockReturnThis(),
          returning: vi.fn().mockResolvedValue([{ traceId: 'trace-1' }]),
        };
        return await cb(tx);
      }),
    });

    const result = await runner.run('conn-1', 'test-stream');
    expect(result.streamResults![0].status).toBe('succeeded');
  });

  it('should bubble up insertion errors during poll loop', async () => {
    dbManagerMock.getTenantDb.mockResolvedValue({
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
      insert: vi.fn().mockReturnThis(),
      values: vi.fn().mockReturnThis(),
      onConflictDoUpdate: vi.fn().mockResolvedValue({}),
      transaction: vi.fn().mockImplementation(async () => {
        throw new Error('Insert failed DB constraint');
      }),
    });

    pieceRegistryMock.getPiece.mockReturnValue({
      describeStreams: vi
        .fn()
        .mockResolvedValue([
          { streamName: 'test-stream', replicationMethod: 'FULL_TABLE' },
        ]),
      poll: vi.fn().mockResolvedValue({
        records: [{ data: { id: 'rec-1' }, replicationKeyValue: '1' }],
        nextPageCursor: undefined,
      }),
    });

    const result = await runner.run('conn-1', 'test-stream');
    expect(result.streamResults![0].status).toBe('failed');
    expect(result.streamResults![0].error).toMatch(
      /Insert failed DB constraint/,
    );
  });

  it('should skip if lock is unavailable', async () => {
    redisMock.set.mockResolvedValueOnce(null);
    const result = await runner.run('conn-1', 'test-stream');
    expect(result.streamResults![0].status).toBe('skipped');
  });

  it('should fail if piece is not registered', async () => {
    pieceRegistryMock.getPiece.mockReturnValue(null);
    await expect(runner.run('conn-1', 'test-stream')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('should fall back to FULL_TABLE if describeStreams returns nothing matching', async () => {
    const result = await runner.run('conn-1', 'unknown-stream');
    expect(result.streamResults![0].streamName).toBe('unknown-stream');
  });

  it('should fall back to FULL_TABLE if describeStreams is missing', async () => {
    pieceRegistryMock.getPiece.mockReturnValue({
      poll: vi
        .fn()
        .mockResolvedValue({ records: [], nextPageCursor: undefined }),
    });
    const result = await runner.run('conn-1', 'unknown-stream');
    expect(result.streamResults![0].streamName).toBe('unknown-stream');
  });

  it('should insert gateway rows for polled records', async () => {
    pieceRegistryMock.getPiece.mockReturnValue({
      describeStreams: vi
        .fn()
        .mockResolvedValue([
          { streamName: 'test-stream', replicationMethod: 'FULL_TABLE' },
        ]),
      poll: vi.fn().mockResolvedValue({
        records: [
          { data: { id: 'rec-1', name: 'John' }, replicationKeyValue: '1' },
          {
            data: { externalId: 'rec-2', name: 'Jane' },
            replicationKeyValue: '2',
          },
        ],
        nextPageCursor: undefined,
      }),
    });
    const result = await runner.run('conn-1', 'test-stream');
    expect(result.streamResults![0].recordsIngested).toBe(2);
  });

  it('should test all branches of extractRecordCursor', async () => {
    pieceRegistryMock.getPiece.mockReturnValue({
      describeStreams: vi
        .fn()
        .mockResolvedValue([
          { streamName: 'test-stream', replicationMethod: 'FULL_TABLE' },
        ]),
      poll: vi.fn().mockResolvedValue({
        records: [
          { data: { Id: 'rec-id-upper' }, replicationKeyValue: undefined },
          { data: { id: 'rec-id-lower' }, replicationKeyValue: undefined },
          { data: { _cursor: 'rec-cursor' }, replicationKeyValue: undefined },
          {
            data: { CreatedDate: '2023-01-02' },
            replicationKeyValue: undefined,
          },
          { data: { id: 123 }, replicationKeyValue: undefined }, // non-string id
          { data: null, replicationKeyValue: undefined },
        ],
        nextPageCursor: undefined,
      }),
    });
    const result = await runner.run('conn-1', 'test-stream');
    expect(result.streamResults![0].recordsIngested).toBe(6);
  });

  it('should return default id when fallback config is empty string after trim', async () => {
    configMock.get.mockReturnValue('  , ,  '); // empty after filter(Boolean)
    const result = await runner.run('conn-1', 'unknown-stream');
    expect(result.streamResults![0].streamName).toBe('unknown-stream');
  });

  it('should handle corrupt state document and reset to default', async () => {
    dbManagerMock.getTenantDb.mockResolvedValue({
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([
        {
          stateDocument: {
            bad: 'data', // Fails schema validation
          },
        },
      ]),
      insert: vi.fn().mockReturnThis(),
      values: vi.fn().mockReturnThis(),
      onConflictDoUpdate: vi.fn().mockResolvedValue({}),
      transaction: vi.fn().mockImplementation(async (cb) => {
        const tx = {
          execute: vi.fn(),
          insert: vi.fn().mockReturnThis(),
          values: vi.fn().mockReturnThis(),
          onConflictDoNothing: vi.fn().mockReturnThis(),
          returning: vi.fn().mockResolvedValue([{ traceId: 'trace-1' }]),
        };
        return await cb(tx);
      }),
    });

    pieceRegistryMock.getPiece.mockReturnValue({
      describeStreams: vi
        .fn()
        .mockResolvedValue([
          { streamName: 'test-stream', replicationMethod: 'FULL_TABLE' },
        ]),
      poll: vi
        .fn()
        .mockResolvedValue({ records: [], nextPageCursor: undefined }),
    });

    const result = await runner.run('conn-1', 'test-stream');
    expect(result.streamResults![0].status).toBe('succeeded');
  });

  it('should extract record cursor from payload if replicationKeyValue is missing', async () => {
    pieceRegistryMock.getPiece.mockReturnValue({
      describeStreams: vi
        .fn()
        .mockResolvedValue([
          { streamName: 'test-stream', replicationMethod: 'FULL_TABLE' },
        ]),
      poll: vi.fn().mockResolvedValue({
        records: [
          { data: { LastModifiedDate: '2023-01-01' } },
          { data: 'string-payload' },
        ],
        nextPageCursor: undefined,
      }),
    });
    const result = await runner.run('conn-1', 'test-stream');
    expect(result.streamResults![0].recordsIngested).toBe(2);
  });

  it('should use fallback key properties if config provides them', async () => {
    configMock.get.mockReturnValue('externalId, type');
    const result = await runner.run('conn-1', 'unknown-stream');
    expect(result.streamResults![0].streamName).toBe('unknown-stream');
  });
});
