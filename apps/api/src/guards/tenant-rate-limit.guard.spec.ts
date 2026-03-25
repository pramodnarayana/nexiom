import { describe, it, expect, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import {
  type ExecutionContext,
  HttpException,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import { REDIS_CLIENT } from '@nexiom/cache';
import { DATABASE_CONNECTION } from '@nexiom/database';
import {
  TenantRateLimitGuard,
  WEBHOOK_RESOLVED_CONNECTION,
} from './tenant-rate-limit.guard.js';

function makeDbMock(row: Record<string, unknown> | null) {
  return {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(row ? [row] : []),
  };
}

function makeExecutionContext(connectionId: string) {
  const setHeaderMock = vi.fn();
  const requestObj: Record<string, unknown> = { params: { connectionId } };
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
  let guard: TenantRateLimitGuard;
  let redisMock: { eval: ReturnType<typeof vi.fn> };
  let db: ReturnType<typeof makeDbMock>;

  async function setup(
    dbRow: Record<string, unknown> | null = {
      tenantId: 'tenant-1',
      metadata: {},
    },
    redisResult: number = -1,
  ) {
    db = makeDbMock(dbRow);
    redisMock = { eval: vi.fn().mockResolvedValue(redisResult) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        TenantRateLimitGuard,
        { provide: REDIS_CLIENT, useValue: redisMock },
        { provide: DATABASE_CONNECTION, useValue: db },
      ],
    }).compile();

    guard = moduleRef.get(TenantRateLimitGuard);
  }

  it('returns true when Redis eval returns -1 (allowed)', async () => {
    await setup(
      { tenantId: 'tenant-1', appName: 'salesforce', metadata: {} },
      -1,
    );
    const { ctx } = makeExecutionContext('conn-1');
    const result = await guard.canActivate(ctx);
    expect(result).toBe(true);
  });

  it('throws HttpException with 429 status when Redis eval returns a TTL', async () => {
    await setup(
      { tenantId: 'tenant-1', appName: 'salesforce', metadata: {} },
      45,
    );
    const { ctx } = makeExecutionContext('conn-1');
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
    const { ctx, setHeaderMock } = makeExecutionContext('conn-1');
    await expect(guard.canActivate(ctx)).rejects.toThrow();
    expect(setHeaderMock).toHaveBeenCalledWith('Retry-After', '45');
  });

  it('attaches resolvedConnection to the request for downstream guards', async () => {
    await setup(
      { tenantId: 'tenant-1', appName: 'salesforce', metadata: { x: 1 } },
      -1,
    );
    const { ctx, requestObj } = makeExecutionContext('conn-1');
    await guard.canActivate(ctx);

    expect(requestObj[WEBHOOK_RESOLVED_CONNECTION]).toEqual({
      tenantId: 'tenant-1',
      appName: 'salesforce',
      metadata: { x: 1 },
    });
  });

  it('uses DEFAULT_LIMIT (1000) when metadata.rateLimitPerMin is absent', async () => {
    await setup(
      { tenantId: 'tenant-1', appName: 'salesforce', metadata: {} },
      -1,
    );
    const { ctx } = makeExecutionContext('conn-1');
    await guard.canActivate(ctx);

    // The second arg to eval is the number of keys (1),
    // followed by: key, limit, window_seconds
    expect(redisMock.eval).toHaveBeenCalledWith(
      expect.any(String),
      1,
      'ratelimit:l1:tenant-1',
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
    const { ctx } = makeExecutionContext('conn-1');
    await guard.canActivate(ctx);

    expect(redisMock.eval).toHaveBeenCalledWith(
      expect.any(String),
      1,
      'ratelimit:l1:tenant-enterprise',
      '5000',
      '60',
    );
  });

  it('throws NotFoundException when connection is not found in DB', async () => {
    await setup(null);
    const { ctx } = makeExecutionContext('missing-conn');
    await expect(guard.canActivate(ctx)).rejects.toThrow(NotFoundException);
  });
});
