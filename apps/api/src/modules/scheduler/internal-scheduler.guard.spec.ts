import { describe, it, expect, beforeEach } from 'vitest';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { InternalSchedulerGuard } from './internal-scheduler.guard.js';

const SECRET = 'super-secret-windmill-token-32chars!!';

function buildContext(authHeader?: string): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        headers: authHeader !== undefined ? { authorization: authHeader } : {},
      }),
    }),
  } as unknown as ExecutionContext;
}

describe('InternalSchedulerGuard', () => {
  let guard: InternalSchedulerGuard;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        InternalSchedulerGuard,
        {
          provide: ConfigService,
          useValue: { getOrThrow: () => SECRET },
        },
      ],
    }).compile();

    guard = module.get(InternalSchedulerGuard);
  });

  it('returns true for the correct bearer token', () => {
    expect(guard.canActivate(buildContext(`Bearer ${SECRET}`))).toBe(true);
  });

  it('throws UnauthorizedException when Authorization header is absent', () => {
    expect(() => guard.canActivate(buildContext())).toThrow(
      UnauthorizedException,
    );
  });

  it('throws UnauthorizedException when scheme is not "Bearer"', () => {
    expect(() => guard.canActivate(buildContext(`Basic ${SECRET}`))).toThrow(
      UnauthorizedException,
    );
  });

  it('throws UnauthorizedException when the token does not match', () => {
    expect(() =>
      guard.canActivate(buildContext('Bearer wrong-secret')),
    ).toThrow(UnauthorizedException);
  });

  it('throws UnauthorizedException for an empty token', () => {
    expect(() => guard.canActivate(buildContext('Bearer '))).toThrow(
      UnauthorizedException,
    );
  });
});
