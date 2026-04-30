import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GitopsWebhookGuard } from './gitops-webhook.guard.js';
import type { ExecutionContext } from '@nestjs/common';

const SECRET = 'test-webhook-secret-value';

function buildContext(authHeader?: string): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        headers: authHeader ? { authorization: authHeader } : {},
      }),
    }),
  } as unknown as ExecutionContext;
}

describe('GitopsWebhookGuard', () => {
  let guard: GitopsWebhookGuard;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        GitopsWebhookGuard,
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: vi.fn().mockReturnValue(SECRET),
          },
        },
      ],
    }).compile();

    guard = module.get<GitopsWebhookGuard>(GitopsWebhookGuard);
  });

  it('should be defined', () => {
    expect(guard).toBeDefined();
  });

  it('should return true for a valid Bearer token', () => {
    const ctx = buildContext(`Bearer ${SECRET}`);
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('should throw UnauthorizedException when Authorization header is absent', () => {
    const ctx = buildContext();
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('should throw UnauthorizedException for a wrong token', () => {
    const ctx = buildContext('Bearer wrong-secret');
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('should throw UnauthorizedException when header is not Bearer format', () => {
    const ctx = buildContext('Basic dXNlcjpwYXNz');
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });
});
