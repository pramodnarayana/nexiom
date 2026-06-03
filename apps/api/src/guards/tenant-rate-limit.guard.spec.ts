import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import {
  BadRequestException,
  type ExecutionContext,
  HttpException,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import { REDIS_CLIENT } from '@soopa/cache';
import { DATABASE_CONNECTION } from '@soopa/database';
import { getLoggerToken } from 'nestjs-pino';
import {
  TenantRateLimitGuard,
  WEBHOOK_RESOLVED_CONNECTION,
} from './tenant-rate-limit.guard.js';

const loggerMock = {
  assign: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
  log: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

const VALID_UUID = '00000000-0000-0000-0000-000000000001';
const VALID_UUID_UNKNOWN = '00000000-0000-0000-0000-000000000999';

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

function makeExecutionContext(dataSourceId: string) {
  const setHeaderMock = vi.fn();
  const requestObj: Record<string, unknown> = { params: { dataSourceId } };
  const ctx = {
    switchToHttp: () => ({
      getRequest: () => requestObj,
      getResponse: () => ({
        setHeader: setHeaderMock,
      }),
    }),
  } as unknown as ExecutionContext;
  return { ctx, setHeaderMock, requestObj };
}

describe('TenantRateLimitGuard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  let guard: TenantRateLimitGuard;
  let redisMock: {
    eval: ReturnType<typeof vi.fn>;
    exists: ReturnType<typeof vi.fn>;
    set: ReturnType<typeof vi.fn>;
  };
  let db: ReturnType<typeof makeDbMock>;

  async function setup(
    dbRow: Record<string, unknown> | null = {
      tenantId: 'tenant-1',
      appName: 'salesforce',
      metadata: {},
    },
    redisResult: number = -1,
  ) {
    db = makeDbMock(dbRow);
    redisMock = {
      eval: vi.fn().mockResolvedValue(redisResult),
      // Default: neg cache miss (0 = key does not exist)
      exists: vi.fn().mockResolvedValue(0),
      set: vi.fn().mockResolvedValue('OK'),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        TenantRateLimitGuard,
        { provide: REDIS_CLIENT, useValue: redisMock },
        { provide: DATABASE_CONNECTION, useValue: db },
        {
          provide: getLoggerToken(TenantRateLimitGuard.name),
          useValue: loggerMock,
        },
      ],
    }).compile();

    guard = moduleRef.get(TenantRateLimitGuard);
  }

  // ── Happy path ──────────────────────────────────────────────────────────────

  it('returns true when Redis eval returns -1 (allowed)', async () => {
    await setup(
      { tenantId: 'tenant-1', appName: 'salesforce', metadata: {} },
      -1,
    );
    const { ctx } = makeExecutionContext(VALID_UUID);
    const result = await guard.canActivate(ctx);
    expect(result).toBe(true);
  });

  it('attaches resolvedConnection to the request for downstream guards', async () => {
    await setup(
      { tenantId: 'tenant-1', appName: 'salesforce', metadata: { x: 1 } },
      -1,
    );
    const { ctx, requestObj } = makeExecutionContext(VALID_UUID);
    await guard.canActivate(ctx);

    expect(requestObj[WEBHOOK_RESOLVED_CONNECTION]).toEqual({
      tenantId: 'tenant-1',
      appName: 'salesforce',
      metadata: { x: 1 },
    });
  });

  // ── Rate limiting ───────────────────────────────────────────────────────────

  it('throws HttpException with 429 status when Redis eval returns a TTL', async () => {
    await setup(
      { tenantId: 'tenant-1', appName: 'salesforce', metadata: {} },
      45,
    );
    const { ctx } = makeExecutionContext(VALID_UUID);
    const err = await guard.canActivate(ctx).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(
      HttpStatus.TOO_MANY_REQUESTS,
    );
  });

  it('sets Retry-After header to the TTL value when rate limited', async () => {
    await setup(
      { tenantId: 'tenant-1', appName: 'salesforce', metadata: {} },
      45,
    );
    const { ctx, setHeaderMock } = makeExecutionContext(VALID_UUID);
    await expect(guard.canActivate(ctx)).rejects.toThrow();
    expect(setHeaderMock).toHaveBeenCalledWith('Retry-After', '45');
  });

  it('uses DEFAULT_LIMIT (1000) when metadata.rateLimitPerMin is absent', async () => {
    await setup(
      { tenantId: 'tenant-1', appName: 'salesforce', metadata: {} },
      -1,
    );
    const { ctx } = makeExecutionContext(VALID_UUID);
    await guard.canActivate(ctx);

    expect(redisMock.eval).toHaveBeenCalledWith(
      expect.any(String),
      1,
      `ratelimit:l1:tenant-1:${VALID_UUID}`,
      '1000',
      '60',
    );
  });

  it('uses metadata.rateLimitPerMin when it is a positive number', async () => {
    await setup(
      {
        tenantId: 'tenant-enterprise',
        appName: 'salesforce',
        metadata: { rateLimitPerMin: 5000 },
      },
      -1,
    );
    const { ctx } = makeExecutionContext(VALID_UUID);
    await guard.canActivate(ctx);

    expect(redisMock.eval).toHaveBeenCalledWith(
      expect.any(String),
      1,
      `ratelimit:l1:tenant-enterprise:${VALID_UUID}`,
      '5000',
      '60',
    );
  });

  // ── Lua TTL normalisation ───────────────────────────────────────────────────

  it('treats Redis result of 0 as rate-limited (not confused with -1 allowed)', async () => {
    // TTL of 0 means the key is about to expire — still rate-limited.
    await setup(
      { tenantId: 'tenant-1', appName: 'salesforce', metadata: {} },
      0,
    );
    const { ctx } = makeExecutionContext(VALID_UUID);
    const err = await guard.canActivate(ctx).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(
      HttpStatus.TOO_MANY_REQUESTS,
    );
  });

  // ── UUID validation (probe protection) ─────────────────────────────────────

  it('throws BadRequestException for a malformed dataSourceId without hitting the DB', async () => {
    await setup(null); // DB would return nothing, but it must not be queried
    const { ctx } = makeExecutionContext('not-a-uuid');

    await expect(guard.canActivate(ctx)).rejects.toThrow(BadRequestException);
    // DB must never be touched for malformed IDs
    expect(db.limit).not.toHaveBeenCalled();
    // Fallback rate limiter must still have been invoked
    expect(redisMock.eval).toHaveBeenCalledWith(
      expect.any(String),
      1,
      'ratelimit:l1:probe',
      expect.any(String),
      expect.any(String),
    );
  });

  it('applies probe fallback rate limit and throws 429 for a malformed ID under heavy probing', async () => {
    await setup(null, 30); // Redis returns 30s TTL (bucket exhausted)
    const { ctx, setHeaderMock } = makeExecutionContext('not-a-uuid');

    const err = await guard.canActivate(ctx).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(
      HttpStatus.TOO_MANY_REQUESTS,
    );
    expect(setHeaderMock).toHaveBeenCalledWith('Retry-After', '30');
    expect(db.limit).not.toHaveBeenCalled();
  });

  it('throws NotFoundException when connection is not found in DB (valid UUID)', async () => {
    await setup(null); // no DB row, Redis returns -1 (fallback passes)
    const { ctx } = makeExecutionContext(VALID_UUID_UNKNOWN);
    await expect(guard.canActivate(ctx)).rejects.toThrow(NotFoundException);
    // Fallback rate limiter was applied before the 404
    expect(redisMock.eval).toHaveBeenCalledWith(
      expect.any(String),
      1,
      `ratelimit:l1:probe:${VALID_UUID_UNKNOWN}`,
      expect.any(String),
      expect.any(String),
    );
  });

  it('applies probe fallback rate limit and throws 429 for an unknown UUID under heavy probing', async () => {
    await setup(null, 15); // Redis returns 15s TTL (bucket exhausted)
    const { ctx, setHeaderMock } = makeExecutionContext(VALID_UUID_UNKNOWN);

    const err = await guard.canActivate(ctx).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(
      HttpStatus.TOO_MANY_REQUESTS,
    );
    expect(setHeaderMock).toHaveBeenCalledWith('Retry-After', '15');
  });

  it('serves neg-cache hit from Redis without querying the DB', async () => {
    await setup(null); // DB would return no rows, but must not be queried
    // Simulate a warm negative cache entry for this dataSourceId
    redisMock.exists.mockResolvedValue(1);
    const { ctx } = makeExecutionContext(VALID_UUID_UNKNOWN);

    await expect(guard.canActivate(ctx)).rejects.toThrow(NotFoundException);
    // DB must be skipped entirely
    expect(db.limit).not.toHaveBeenCalled();
    // Per-connection probe bucket must still be consulted
    expect(redisMock.eval).toHaveBeenCalledWith(
      expect.any(String),
      1,
      `ratelimit:l1:probe:${VALID_UUID_UNKNOWN}`,
      expect.any(String),
      expect.any(String),
    );
  });

  it('populates the neg cache on first DB miss so subsequent probes skip Postgres', async () => {
    await setup(null); // DB miss
    const { ctx } = makeExecutionContext(VALID_UUID_UNKNOWN);

    await expect(guard.canActivate(ctx)).rejects.toThrow(NotFoundException);
    // The neg cache SET must have been called with the connection's key and a positive TTL
    expect(redisMock.set).toHaveBeenCalledWith(
      `ratelimit:l1:neg:${VALID_UUID_UNKNOWN}`,
      '1',
      'EX',
      expect.any(Number),
    );
  });

  // ── resolveLimit edge cases ─────────────────────────────────────────────────

  it('falls back to DEFAULT_LIMIT (1000) when rateLimitPerMin is a negative number', async () => {
    await setup(
      {
        tenantId: 'tenant-1',
        appName: 'salesforce',
        metadata: { rateLimitPerMin: -5 },
      },
      -1,
    );
    const { ctx } = makeExecutionContext(VALID_UUID);
    await guard.canActivate(ctx);

    expect(redisMock.eval).toHaveBeenCalledWith(
      expect.any(String),
      1,
      `ratelimit:l1:tenant-1:${VALID_UUID}`,
      '1000',
      '60',
    );
  });

  it('falls back to DEFAULT_LIMIT (1000) when rateLimitPerMin is a non-number', async () => {
    await setup(
      {
        tenantId: 'tenant-1',
        appName: 'salesforce',
        metadata: { rateLimitPerMin: 'fast' },
      },
      -1,
    );
    const { ctx } = makeExecutionContext(VALID_UUID);
    await guard.canActivate(ctx);

    expect(redisMock.eval).toHaveBeenCalledWith(
      expect.any(String),
      1,
      `ratelimit:l1:tenant-1:${VALID_UUID}`,
      '1000',
      '60',
    );
  });

  it('falls back to DEFAULT_LIMIT (1000) when rateLimitPerMin is a fractional number', async () => {
    await setup(
      {
        tenantId: 'tenant-1',
        appName: 'salesforce',
        metadata: { rateLimitPerMin: 3.7 },
      },
      -1,
    );
    const { ctx } = makeExecutionContext(VALID_UUID);
    await guard.canActivate(ctx);

    // Redis counters are integers — fractional values must fall back to the default
    expect(redisMock.eval).toHaveBeenCalledWith(
      expect.any(String),
      1,
      `ratelimit:l1:tenant-1:${VALID_UUID}`,
      '1000',
      '60',
    );
  });

  it('clamps rateLimitPerMin to MAX_RATE_LIMIT (10000) when value exceeds the ceiling', async () => {
    await setup(
      {
        tenantId: 'tenant-enterprise',
        appName: 'salesforce',
        metadata: { rateLimitPerMin: 99999 },
      },
      -1,
    );
    const { ctx } = makeExecutionContext(VALID_UUID);
    await guard.canActivate(ctx);

    expect(redisMock.eval).toHaveBeenCalledWith(
      expect.any(String),
      1,
      `ratelimit:l1:tenant-enterprise:${VALID_UUID}`,
      '10000',
      '60',
    );
  });
});
