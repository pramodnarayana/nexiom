import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { DATABASE_CONNECTION } from '@nexiom/database';
import { WebhooksController } from './webhooks.controller.js';
import { WebhookSignatureGuard } from './webhook-signature.guard.js';
import { TenantRateLimitGuard } from '../../guards/tenant-rate-limit.guard.js';
import { StorageResolverService } from '../storage-resolver/storage-resolver.service.js';

function makeDbMock() {
  const insertMock = vi
    .fn()
    .mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) });
  const executeMock = vi.fn().mockResolvedValue(undefined);

  const txMock = {
    execute: executeMock,
    insert: insertMock,
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

describe('WebhooksController', () => {
  let controller: WebhooksController;
  let db: ReturnType<typeof makeDbMock>;
  let storageResolver: { resolveSchemaName: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    db = makeDbMock();
    storageResolver = {
      resolveSchemaName: vi.fn().mockResolvedValue('ws_test_001'),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [WebhooksController],
      providers: [
        { provide: DATABASE_CONNECTION, useValue: db },
        { provide: StorageResolverService, useValue: storageResolver },
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

  it('returns 202 (does not throw) when DB throws error with code 23505', async () => {
    const pgError = new Error('unique_violation') as Error & { code: string };
    pgError.code = '23505';
    db.transaction.mockRejectedValueOnce(pgError);

    await expect(
      controller.ingest(
        '00000000-0000-0000-0000-000000000001',
        { foo: 'bar' },
        {},
      ),
    ).resolves.toBeUndefined();
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
});
