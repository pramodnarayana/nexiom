import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { DATABASE_CONNECTION } from '@nexiom/database';
import { QueueService, QueueName } from '@nexiom/queue';
import { getLoggerToken } from 'nestjs-pino';
import { WebhooksController } from './webhooks.controller.js';
import { WebhookSignatureGuard } from './webhook-signature.guard.js';
import { TenantRateLimitGuard } from '../../guards/tenant-rate-limit.guard.js';
import { StorageResolverService } from '@nexiom/engine';

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
    .mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) });
  const executeMock = vi.fn().mockResolvedValue(undefined);

  const updateMock = vi.fn().mockReturnThis();

  const txMock = {
    execute: executeMock,
    insert: insertMock,
    update: updateMock,
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue(undefined),
  };

  return {
    transaction: vi.fn(async (cb: (tx: typeof txMock) => Promise<void>) => {
      await cb(txMock);
    }),
    _tx: txMock,
    _insertMock: insertMock,
    _executeMock: executeMock,
  };
}

const queueServiceMock = {
  send: vi.fn().mockResolvedValue(undefined),
};

describe('WebhooksController', () => {
  let controller: WebhooksController;
  let db: ReturnType<typeof makeDbMock>;
  let storageResolver: { resolveSchemaName: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    vi.clearAllMocks();
    db = makeDbMock();
    storageResolver = {
      resolveSchemaName: vi.fn().mockResolvedValue('ws_test_001'),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [WebhooksController],
      providers: [
        { provide: DATABASE_CONNECTION, useValue: db },
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
      ),
    ).resolves.toBeUndefined();

    expect(db.transaction).toHaveBeenCalledOnce();
    expect(db._tx.insert).toHaveBeenCalledOnce();
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
      ),
    ).rejects.toThrow('connection refused');

    expect(loggerMock.error).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'l1.error' }),
      'L1 ingest failed',
    );
  });

  it('uses x-webhook-id header as extReqId when present', async () => {
    let capturedValues: Record<string, unknown> | undefined;
    db._tx.insert.mockReturnValue({
      values: vi.fn((v: Record<string, unknown>) => {
        capturedValues = v;
        return Promise.resolve();
      }),
    });

    await controller.ingest(
      '00000000-0000-0000-0000-000000000001',
      { data: 1 },
      { 'x-webhook-id': 'sf-event-123' },
    );

    expect(capturedValues).toBeDefined();
    expect(capturedValues?.['extReqId']).toBe('sf-event-123');
  });

  it('sets extReqId to undefined when neither x-webhook-id nor x-event-id is present', async () => {
    let capturedValues: Record<string, unknown> | undefined;
    db._tx.insert.mockReturnValue({
      values: vi.fn((v: Record<string, unknown>) => {
        capturedValues = v;
        return Promise.resolve();
      }),
    });

    await controller.ingest(
      '00000000-0000-0000-0000-000000000001',
      { data: 1 },
      { 'content-type': 'application/json' },
    );

    expect(capturedValues).toBeDefined();
    expect(capturedValues?.['extReqId']).toBeUndefined();
  });

  it('only persists allowlisted headers (strips sensitive headers)', async () => {
    let capturedValues: Record<string, unknown> | undefined;
    db._tx.insert.mockReturnValue({
      values: vi.fn((v: Record<string, unknown>) => {
        capturedValues = v;
        return Promise.resolve();
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
    db._tx.insert.mockReturnValue({
      values: vi.fn((v: Record<string, unknown>) => {
        capturedValues = v;
        return Promise.resolve();
      }),
    });

    await controller.ingest(
      '00000000-0000-0000-0000-000000000001',
      { data: 1 },
      { 'x-event-id': 'qb-event-456' },
    );

    expect(capturedValues).toBeDefined();
    expect(capturedValues?.['extReqId']).toBe('qb-event-456');
  });

  it('enqueues to InboundQueue on success path', async () => {
    await controller.ingest(
      '00000000-0000-0000-0000-000000000001',
      { foo: 'bar' },
      {},
    );

    expect(queueServiceMock.send).toHaveBeenCalledWith(QueueName.InboundQueue, {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      traceId: expect.any(String),
      connectionId: '00000000-0000-0000-0000-000000000001',
    });
  });

  it('logs warning and marks record PENDING when enqueue fails (no rethrow)', async () => {
    queueServiceMock.send.mockRejectedValueOnce(new Error('SQS down'));

    await expect(
      controller.ingest(
        '00000000-0000-0000-0000-000000000001',
        { foo: 'bar' },
        {},
      ),
    ).resolves.toBeUndefined();

    await vi.waitFor(() => {
      expect(loggerMock.warn).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'l1.enqueue_failed' }),
        expect.stringContaining('Failed to enqueue'),
      );
    });
  });
});
