import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import {
  type ExecutionContext,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { WebhookSignatureGuard } from './webhook-signature.guard.js';
import { PieceRegistryService } from '@soopa/piece-registry';
import { DATABASE_CONNECTION } from '@soopa/database';
import { getLoggerToken } from 'nestjs-pino';
import { WEBHOOK_RESOLVED_CONNECTION } from '../../guards/tenant-rate-limit.guard.js';

const loggerMock = {
  assign: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
  log: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
});

function makeExecutionContext(
  params: Record<string, string>,
  headers: Record<string, string>,
  rawBody?: Buffer,
  resolvedConnection?: Record<string, unknown>,
): ExecutionContext {
  const requestObj: Record<string, unknown> = { params, headers, rawBody };
  if (resolvedConnection !== undefined) {
    requestObj[WEBHOOK_RESOLVED_CONNECTION] = resolvedConnection;
  }
  return {
    switchToHttp: () => ({
      getRequest: () => requestObj,
    }),
  } as unknown as ExecutionContext;
}

function makeDbMock(row: Record<string, unknown> | null) {
  return {
    select: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    leftJoin: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(row ? [row] : []),
  };
}

const SALESFORCE_PIECE_WITH_WEBHOOK_BASE64 = {
  name: 'salesforce',
  webhook: {
    secretKeyEnv: 'SF_SECRET',
    signatureHeader: 'X-Salesforce-Signature',
    signatureEncoding: 'base64',
  },
};

describe('WebhookSignatureGuard', () => {
  let guard: WebhookSignatureGuard;
  let db: ReturnType<typeof makeDbMock>;

  async function setup(
    dbRow: Record<string, unknown> | null = { appName: 'salesforce' },
    piece: unknown = undefined,
    configMap: Record<string, string> = {},
  ) {
    db = makeDbMock(dbRow);

    const moduleRef = await Test.createTestingModule({
      providers: [
        WebhookSignatureGuard,
        {
          provide: ConfigService,
          useValue: {
            get: vi.fn((key: string) => configMap[key]),
          },
        },
        {
          provide: PieceRegistryService,
          useValue: {
            getPiece: vi.fn().mockReturnValue(piece),
          },
        },
        {
          provide: DATABASE_CONNECTION,
          useValue: db,
        },
        {
          provide: getLoggerToken(WebhookSignatureGuard.name),
          useValue: loggerMock,
        },
      ],
    }).compile();

    guard = moduleRef.get(WebhookSignatureGuard);
  }

  // ── Pass-through ────────────────────────────────────────────────────────────

  it('returns true when piece has no webhook config (pass-through)', async () => {
    await setup({ appName: 'salesforce' }, { name: 'salesforce' });

    const ctx = makeExecutionContext(
      { dataSourceId: 'conn-1' },
      {},
      Buffer.from('body'),
    );
    const result = await guard.canActivate(ctx);
    expect(result).toBe(true);
  });

  // ── Cached connection (no second DB query) ──────────────────────────────────

  it('skips the DB query when resolvedConnection is already on the request', async () => {
    await setup(
      null, // DB returns nothing — guard must not query it
      { name: 'salesforce' },
    );

    const ctx = makeExecutionContext(
      { dataSourceId: 'conn-1' },
      {},
      Buffer.from('body'),
      { appName: 'salesforce', tenantId: 'tenant-1', metadata: {} },
    );

    const result = await guard.canActivate(ctx);
    expect(result).toBe(true);
    // DB limit() must not have been called
    expect(db.limit).not.toHaveBeenCalled();
  });

  // ── Valid signature (base64) ────────────────────────────────────────────────

  it('returns true when base64 signature is valid', async () => {
    const secret = 'test-secret';
    const body = Buffer.from('body');
    // Compute the expected signature the same way the guard does: raw binary digest,
    // then encode to base64 for the header value.
    const validSig = createHmac('sha256', secret).update(body).digest('base64');

    await setup(
      { appName: 'salesforce' },
      SALESFORCE_PIECE_WITH_WEBHOOK_BASE64,
      { SF_SECRET: secret },
    );

    const ctx = makeExecutionContext(
      { dataSourceId: 'conn-1' },
      { 'x-salesforce-signature': validSig },
      body,
    );
    const result = await guard.canActivate(ctx);
    expect(result).toBe(true);
  });

  // ── Valid signature (hex) ───────────────────────────────────────────────────

  it('returns true when hex signature is valid', async () => {
    const secret = 'test-secret';
    const body = Buffer.from('body');
    const validSig = createHmac('sha256', secret).update(body).digest('hex');

    await setup(
      { appName: 'quickbooks' },
      {
        name: 'quickbooks',
        webhook: {
          secretKeyEnv: 'QB_SECRET',
          signatureHeader: 'intuit-signature',
          signatureEncoding: 'hex',
        },
      },
      { QB_SECRET: secret },
    );

    const ctx = makeExecutionContext(
      { dataSourceId: 'conn-1' },
      { 'intuit-signature': validSig },
      body,
    );
    const result = await guard.canActivate(ctx);
    expect(result).toBe(true);
  });

  it('accepts uppercase hex signature (case-insensitive binary comparison)', async () => {
    const secret = 'test-secret';
    const body = Buffer.from('body');
    // Vendor sends uppercase hex; our computed digest is lowercase — must still match.
    const validSigUppercase = createHmac('sha256', secret)
      .update(body)
      .digest('hex')
      .toUpperCase();

    await setup(
      { appName: 'quickbooks' },
      {
        name: 'quickbooks',
        webhook: {
          secretKeyEnv: 'QB_SECRET',
          signatureHeader: 'intuit-signature',
          signatureEncoding: 'hex',
        },
      },
      { QB_SECRET: secret },
    );

    const ctx = makeExecutionContext(
      { dataSourceId: 'conn-1' },
      { 'intuit-signature': validSigUppercase },
      body,
    );
    const result = await guard.canActivate(ctx);
    expect(result).toBe(true);
  });

  // ── Error paths ─────────────────────────────────────────────────────────────

  it('throws ForbiddenException when signatureHeader is missing', async () => {
    await setup(
      { appName: 'salesforce' },
      SALESFORCE_PIECE_WITH_WEBHOOK_BASE64,
      { SF_SECRET: 'test-secret' },
    );

    const ctx = makeExecutionContext(
      { dataSourceId: 'conn-1' },
      {},
      Buffer.from('body'),
    );
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it('throws ForbiddenException when signature is invalid', async () => {
    await setup(
      { appName: 'salesforce' },
      SALESFORCE_PIECE_WITH_WEBHOOK_BASE64,
      { SF_SECRET: 'test-secret' },
    );

    const ctx = makeExecutionContext(
      { dataSourceId: 'conn-1' },
      { 'x-salesforce-signature': 'wrong-signature' },
      Buffer.from('body'),
    );
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it('throws ForbiddenException when secret env var is not configured', async () => {
    await setup(
      { appName: 'salesforce' },
      SALESFORCE_PIECE_WITH_WEBHOOK_BASE64,
      {}, // no SF_SECRET
    );

    const ctx = makeExecutionContext(
      { dataSourceId: 'conn-1' },
      { 'x-salesforce-signature': 'some-sig' },
      Buffer.from('body'),
    );
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it('throws NotFoundException when connection is not found in DB', async () => {
    await setup(null);

    const ctx = makeExecutionContext(
      { dataSourceId: 'missing-conn' },
      {},
      Buffer.from('body'),
    );
    await expect(guard.canActivate(ctx)).rejects.toThrow(NotFoundException);
  });

  // ── Unregistered piece (fail-closed regression) ────────────────────────────

  it('throws NotFoundException when the connection appName maps to an unregistered piece', async () => {
    // piece = undefined (default) simulates getPiece() returning undefined
    await setup({ appName: 'unregistered-piece' }, undefined);

    const ctx = makeExecutionContext(
      { dataSourceId: 'conn-1' },
      {},
      Buffer.from('body'),
    );
    // Guard must fail closed — not silently pass through
    await expect(guard.canActivate(ctx)).rejects.toThrow(NotFoundException);
  });

  it('throws ForbiddenException when rawBody is empty/missing', async () => {
    await setup(
      { appName: 'salesforce' },
      SALESFORCE_PIECE_WITH_WEBHOOK_BASE64,
      { SF_SECRET: 'test-secret' },
    );

    const ctx = makeExecutionContext(
      { dataSourceId: 'conn-1' },
      { 'x-salesforce-signature': 'some-sig' },
      undefined,
    );
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });
});
