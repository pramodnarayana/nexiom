import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { DATABASE_CONNECTION } from '@nexiom/database';
import { DB_MANAGER } from '@nexiom/dbmanager';
import { REDIS_CLIENT } from '@nexiom/cache';
import { TokenManagerService } from '@nexiom/credentials';
import { PieceRegistryService } from '@nexiom/piece-registry';
import { CursorManagerService, StorageResolverService } from '@nexiom/engine';
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

    dbManagerMock = {
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
            const tx = {
              execute: vi.fn(),
              insert: vi.fn().mockReturnThis(),
              values: vi.fn().mockReturnThis(),
              onConflictDoNothing: vi.fn().mockReturnThis(),
              returning: vi.fn().mockResolvedValue([{ traceId: 'trace-1' }]),
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
