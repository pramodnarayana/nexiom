/* eslint-disable @typescript-eslint/no-unsafe-argument */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { DATABASE_CONNECTION } from '@soopa/database';
import { DB_MANAGER } from '@soopa/dbmanager';
import { QueueService, QueueName } from '@soopa/queue';
import { getLoggerToken } from 'nestjs-pino';
import { WebhooksController } from './webhooks.controller.js';
import { WebhookSignatureGuard } from './webhook-signature.guard.js';
import { TenantRateLimitGuard } from '../../guards/tenant-rate-limit.guard.js';
import { StorageResolverService } from '@soopa/engine';
import { executeAppWebhookResponses } from '@soopa/piece-framework';

vi.mock('@soopa/piece-framework', () => ({
  executeAppWebhookResponses: vi.fn(),
}));

const loggerMock = {
  assign: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
  log: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

function makeDbMock() {
  const insertMock = vi
    .fn()
    // First call → inboundGateway: plain insert, just needs to be awaitable
    .mockReturnValueOnce({ values: vi.fn().mockResolvedValue(undefined) })
    // Subsequent calls → inboundOutbox: needs onConflictDoNothing chain
    .mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoNothing: vi.fn().mockResolvedValue(undefined),
      }),
    });
  const executeMock = vi.fn().mockResolvedValue(undefined);

  // Return a fluent builder that mirrors Drizzle's tx.update(...).set(...).where(...) chain.
  const setMock = vi.fn().mockReturnThis();
  const whereMock = vi.fn().mockResolvedValue(undefined);
  const updateBuilder = { set: setMock, where: whereMock };
  const updateMock = vi.fn().mockReturnValue(updateBuilder);

  const txMock = {
    execute: executeMock,
    insert: insertMock,
    update: updateMock,
  };

  return {
    transaction: vi.fn(async (cb: (tx: typeof txMock) => Promise<void>) => {
      await cb(txMock);
    }),
    _tx: txMock,
    _insertMock: insertMock,
    _executeMock: executeMock,
    _setMock: setMock,
  };
}

const queueServiceMock = {
  send: vi.fn().mockResolvedValue(undefined),
};

describe('WebhooksController', () => {
  let controller: WebhooksController;
  let db: ReturnType<typeof makeDbMock>;
  let storageResolver: {
    resolveSchemaName: ReturnType<typeof vi.fn>;
    resolveStorageProfile: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    db = makeDbMock();
    storageResolver = {
      resolveSchemaName: vi.fn().mockResolvedValue('ws_test_001'),
      resolveStorageProfile: vi.fn().mockResolvedValue({
        schemaName: 'ws_test_001',
        tenantId: 'tenant_001',
      }),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [WebhooksController],
      providers: [
        { provide: DATABASE_CONNECTION, useValue: db },
        {
          provide: DB_MANAGER,
          useValue: { getTenantDb: vi.fn().mockResolvedValue(db) },
        },
        { provide: StorageResolverService, useValue: storageResolver },
        { provide: QueueService, useValue: queueServiceMock },
        {
          provide: getLoggerToken(WebhooksController.name),
          useValue: loggerMock,
        },
      ],
    })
      .overrideGuard(WebhookSignatureGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(TenantRateLimitGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = moduleRef.get(WebhooksController);
  });

  it('returns 202 and inserts record on success path', async () => {
    await expect(
      controller.ingest(
        '00000000-0000-0000-0000-000000000001',
        { foo: 'bar' },
        {},
        {} as any,
        {} as any,
      ),
    ).resolves.toBeUndefined();

    expect(db.transaction).toHaveBeenCalledOnce();
    // Controller inserts into two tables: inboundGateway + inboundOutbox
    expect(db._tx.insert).toHaveBeenCalledTimes(2);
  });

  it('returns 202 (does not throw) when DB throws 23505 on a known idempotency constraint', async () => {
    const pgError = Object.assign(new Error('unique_violation'), {
      code: '23505',
      constraint: 'idx_l1_ext_id',
    });
    db.transaction.mockRejectedValueOnce(pgError);

    await expect(
      controller.ingest(
        '00000000-0000-0000-0000-000000000001',
        { foo: 'bar' },
        {},
        {} as any,
        {} as any,
      ),
    ).resolves.toBeUndefined();
  });

  it('returns 202 (does not throw) when DB throws 23505 with detail containing ext_req_id', async () => {
    const pgError = Object.assign(new Error('unique_violation'), {
      code: '23505',
      detail: 'Key (data_source_id, ext_req_id)=(..., ...) already exists.',
    });
    db.transaction.mockRejectedValueOnce(pgError);

    await expect(
      controller.ingest(
        '00000000-0000-0000-0000-000000000001',
        { foo: 'bar' },
        {},
        {} as any,
        {} as any,
      ),
    ).resolves.toBeUndefined();
  });

  it('re-throws 23505 when the violated constraint is not an idempotency constraint', async () => {
    const pgError = Object.assign(new Error('unique_violation'), {
      code: '23505',
      constraint: 'some_other_unique_index',
    });
    db.transaction.mockRejectedValueOnce(pgError);

    await expect(
      controller.ingest(
        '00000000-0000-0000-0000-000000000001',
        { foo: 'bar' },
        {},
        {} as any,
        {} as any,
      ),
    ).rejects.toThrow('unique_violation');
  });

  it('re-throws error when DB throws a non-23505 error', async () => {
    const genericError = new Error('connection refused') as Error & {
      code: string;
    };
    genericError.code = '42000';
    db.transaction.mockRejectedValueOnce(genericError);

    await expect(
      controller.ingest(
        '00000000-0000-0000-0000-000000000001',
        { foo: 'bar' },
        {},
        {} as any,
        {} as any,
      ),
    ).rejects.toThrow('connection refused');

    expect(loggerMock.error).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'l1.error' }),
      'L1 ingest failed',
    );
  });

  it('uses x-webhook-id header as extReqId when present', async () => {
    let capturedValues: Record<string, unknown> | undefined;
    db._tx.insert.mockReset(); // clear makeDbMock() queue before per-test overrides
    db._tx.insert
      // First call → inboundGateway: capture the inserted values
      .mockReturnValueOnce({
        values: vi.fn((v: Record<string, unknown>) => {
          capturedValues = v;
          return Promise.resolve(undefined);
        }),
      })
      // Second call → inboundOutbox: onConflictDoNothing chain
      .mockReturnValue({
        values: vi.fn().mockReturnValue({
          onConflictDoNothing: vi.fn().mockResolvedValue(undefined),
        }),
      });

    await controller.ingest(
      '00000000-0000-0000-0000-000000000001',
      { data: 1 },
      { 'x-webhook-id': 'sf-event-123' },
      {} as any,
      {} as any,
    );

    expect(capturedValues).toBeDefined();
    expect(capturedValues?.['extReqId']).toBe('sf-event-123');
  });

  it('sets extReqId to undefined when neither x-webhook-id nor x-event-id is present', async () => {
    let capturedValues: Record<string, unknown> | undefined;
    db._tx.insert.mockReset();
    db._tx.insert
      .mockReturnValueOnce({
        values: vi.fn((v: Record<string, unknown>) => {
          capturedValues = v;
          return Promise.resolve(undefined);
        }),
      })
      .mockReturnValue({
        values: vi.fn().mockReturnValue({
          onConflictDoNothing: vi.fn().mockResolvedValue(undefined),
        }),
      });

    await controller.ingest(
      '00000000-0000-0000-0000-000000000001',
      { data: 1 },
      { 'content-type': 'application/json' },
      {} as any,
      {} as any,
    );

    expect(capturedValues).toBeDefined();
    expect(capturedValues?.['extReqId']).toBeUndefined();
  });

  it('handles custom app responses returned by executeAppWebhookResponses', async () => {
    vi.mocked(executeAppWebhookResponses).mockReturnValueOnce({
      status: 202,
      contentType: 'text/plain',
      body: 'Accepted by Piece',
    });

    const resMock = {
      status: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      send: vi.fn(),
    };

    await controller.ingest(
      '00000000-0000-0000-0000-000000000001',
      { data: 1 },
      { 'content-type': 'application/json' },
      {} as any,
      resMock as any,
    );

    expect(executeAppWebhookResponses).toHaveBeenCalled();
    expect(resMock.status).toHaveBeenCalledWith(202);
    expect(resMock.set).toHaveBeenCalledWith('Content-Type', 'text/plain');
    expect(resMock.send).toHaveBeenCalledWith('Accepted by Piece');

    // Verify it updated the inboundGateway row
    expect(db._tx.update).toHaveBeenCalled();
    expect(db._setMock).toHaveBeenCalledWith(
      expect.objectContaining({
        response: {
          status: 202,
          contentType: 'text/plain',
          body: 'Accepted by Piece',
        },
      }),
    );
  });

  it('only persists allowlisted headers (strips sensitive headers)', async () => {
    let capturedValues: Record<string, unknown> | undefined;
    db._tx.insert.mockReset();
    db._tx.insert
      .mockReturnValueOnce({
        values: vi.fn((v: Record<string, unknown>) => {
          capturedValues = v;
          return Promise.resolve(undefined);
        }),
      })
      .mockReturnValue({
        values: vi.fn().mockReturnValue({
          onConflictDoNothing: vi.fn().mockResolvedValue(undefined),
        }),
      });

    await controller.ingest(
      '00000000-0000-0000-0000-000000000001',
      { data: 1 },
      {
        'content-type': 'application/json',
        authorization: 'Bearer secret-token',
        'x-salesforce-signature': 'hmac-value',
        'x-request-id': 'req-123',
        cookie: 'session=abc',
      },
      {} as any,
      {} as any,
    );

    const stored = capturedValues?.['headers'] as
      | Record<string, string>
      | undefined;
    expect(stored).toBeDefined();
    expect(stored?.['content-type']).toBe('application/json');
    expect(stored?.['x-request-id']).toBe('req-123');
    // Sensitive headers must not be persisted
    expect(stored?.['authorization']).toBeUndefined();
    expect(stored?.['x-salesforce-signature']).toBeUndefined();
    expect(stored?.['cookie']).toBeUndefined();
  });

  it('uses x-event-id header as extReqId when x-webhook-id is absent', async () => {
    let capturedValues: Record<string, unknown> | undefined;
    db._tx.insert.mockReset();
    db._tx.insert
      .mockReturnValueOnce({
        values: vi.fn((v: Record<string, unknown>) => {
          capturedValues = v;
          return Promise.resolve(undefined);
        }),
      })
      .mockReturnValue({
        values: vi.fn().mockReturnValue({
          onConflictDoNothing: vi.fn().mockResolvedValue(undefined),
        }),
      });

    await controller.ingest(
      '00000000-0000-0000-0000-000000000001',
      { data: 1 },
      { 'x-event-id': 'qb-event-456' },
      {} as any,
      {} as any,
    );

    expect(capturedValues).toBeDefined();
    expect(capturedValues?.['extReqId']).toBe('qb-event-456');
  });

  it('enqueues to InboundQueue on success path', async () => {
    await controller.ingest(
      '00000000-0000-0000-0000-000000000001',
      { foo: 'bar' },
      {},
      {} as any,
      {} as any,
    );

    expect(queueServiceMock.send).toHaveBeenCalledWith(QueueName.InboundQueue, {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      traceId: expect.any(String),
      dataSourceId: '00000000-0000-0000-0000-000000000001',
    });
  });

  it('logs error and rethrows when enqueue fails', async () => {
    queueServiceMock.send.mockRejectedValueOnce(new Error('SQS down'));

    await expect(
      controller.ingest(
        '00000000-0000-0000-0000-000000000001',
        { foo: 'bar' },
        {},
        {} as any,
        {} as any,
      ),
    ).rejects.toThrow('SQS down');

    await vi.waitFor(() => {
      expect(loggerMock.error).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'l1.enqueue_failed' }),
        expect.stringContaining('rejecting webhook'),
      );
    });
  });

  it('normalizes string payloads into raw wrappers', async () => {
    let capturedValues: Record<string, unknown> | undefined;
    db._tx.insert.mockReset();
    db._tx.insert
      .mockReturnValueOnce({
        values: vi.fn((v: Record<string, unknown>) => {
          capturedValues = v;
          return Promise.resolve(undefined);
        }),
      })
      .mockReturnValue({
        values: vi.fn().mockReturnValue({
          onConflictDoNothing: vi.fn().mockResolvedValue(undefined),
        }),
      });

    await controller.ingest(
      '00000000-0000-0000-0000-000000000001',
      '<xml>data</xml>',
      { 'content-type': 'application/xml' },
      {} as any,
      {} as any,
    );

    expect(capturedValues).toBeDefined();
    expect(capturedValues?.['request']).toEqual({
      raw: '<xml>data</xml>',
      contentType: 'application/xml',
    });
  });

  it('looks up existing trace and re-enqueues on idempotency collision', async () => {
    const pgError = Object.assign(new Error('unique_violation'), {
      code: '23505',
      constraint: 'idx_l1_ext_id',
    });
    // First transaction (insert) throws unique_violation
    // Second transaction (lookup) returns an existing record
    db.transaction
      .mockRejectedValueOnce(pgError)
      .mockImplementationOnce(async (cb: (tx: any) => Promise<void>) => {
        const mockTx = {
          execute: vi.fn().mockResolvedValue(undefined),
          select: vi.fn().mockReturnThis(),
          innerJoin: vi.fn().mockReturnThis(),
          leftJoin: vi.fn().mockReturnThis(),
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          limit: vi
            .fn()
            .mockResolvedValue([
              { traceId: 'existing-trace-id', response: null },
            ]),
        };
        await cb(mockTx);
      });

    await expect(
      controller.ingest(
        '00000000-0000-0000-0000-000000000001',
        { foo: 'bar' },
        { 'x-webhook-id': 'sf-event-123' },
        {} as any,
        {
          status: vi.fn().mockReturnThis(),
          set: vi.fn().mockReturnThis(),
          send: vi.fn(),
        } as any,
      ),
    ).resolves.toBeUndefined();

    // Verify it attempted to re-enqueue
    expect(queueServiceMock.send).toHaveBeenCalledWith(QueueName.InboundQueue, {
      traceId: 'existing-trace-id',
      dataSourceId: '00000000-0000-0000-0000-000000000001',
    });
  });

  it('returns app-defined synchronous response on idempotency collision', async () => {
    const pgError = Object.assign(new Error('unique_violation'), {
      code: '23505',
      constraint: 'idx_l1_ext_id',
    });
    db.transaction
      .mockRejectedValueOnce(pgError)
      .mockImplementationOnce(async (cb: (tx: any) => Promise<void>) => {
        const mockTx = {
          execute: vi.fn().mockResolvedValue(undefined),
          select: vi.fn().mockReturnThis(),
          innerJoin: vi.fn().mockReturnThis(),
          leftJoin: vi.fn().mockReturnThis(),
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          limit: vi
            .fn()
            .mockResolvedValue([
              { traceId: 'existing-trace-id', response: null },
            ]),
          update: vi.fn().mockReturnThis(),
          set: vi.fn().mockReturnThis(),
        };
        await cb(mockTx);
      });

    vi.mocked(executeAppWebhookResponses).mockReturnValue({
      status: 200,
      contentType: 'text/xml',
      body: '<response>ok</response>',
    });

    const mockRes = {
      status: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      send: vi.fn(),
    };

    await controller.ingest(
      '00000000-0000-0000-0000-000000000001',
      { foo: 'bar' },
      { 'x-webhook-id': 'sf-event-123' },
      {} as any,
      mockRes as any,
    );

    expect(mockRes.status).toHaveBeenCalledWith(200);
    expect(mockRes.set).toHaveBeenCalledWith('Content-Type', 'text/xml');
    expect(mockRes.send).toHaveBeenCalledWith('<response>ok</response>');

    vi.mocked(executeAppWebhookResponses).mockReturnValue(null); // reset
  });
});
