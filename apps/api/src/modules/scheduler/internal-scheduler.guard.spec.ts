import { describe, it, expect, beforeEach } from 'vitest';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InternalSchedulerGuard } from './internal-scheduler.guard.js';

const SECRET = 'test-secret-exactly-32-bytes!!x';

const makeContext = (authHeader?: string): ExecutionContext =>
  ({
    switchToHttp: () => ({
      getRequest: () => ({
        headers: authHeader ? { authorization: authHeader } : {},
      }),
    }),
  }) as unknown as ExecutionContext;

const makeGuard = (secret = SECRET) =>
  new InternalSchedulerGuard({
    getOrThrow: () => secret,
  } as unknown as ConfigService);

describe('InternalSchedulerGuard', () => {
  let guard: InternalSchedulerGuard;

  beforeEach(() => {
    guard = makeGuard();
  });

  it('returns true for a correct Bearer token', () => {
    expect(guard.canActivate(makeContext(`Bearer ${SECRET}`))).toBe(true);
  });

  it('throws 401 when the Authorization header is absent', () => {
    expect(() => guard.canActivate(makeContext())).toThrow(
      UnauthorizedException,
    );
  });

  it('throws 401 when the token does not match', () => {
    expect(() => guard.canActivate(makeContext('Bearer wrong-token'))).toThrow(
      UnauthorizedException,
    );
  });

  it('throws 401 when the scheme is not Bearer', () => {
    expect(() => guard.canActivate(makeContext(`Basic ${SECRET}`))).toThrow(
      UnauthorizedException,
    );
  });

  it('throws 401 for an empty Bearer value', () => {
    expect(() => guard.canActivate(makeContext('Bearer '))).toThrow(
      UnauthorizedException,
    );
  });
});
