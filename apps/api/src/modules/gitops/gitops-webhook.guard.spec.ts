import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GitopsWebhookGuard } from './gitops-webhook.guard.js';
import type { ExecutionContext } from '@nestjs/common';
import * as crypto from 'crypto';

const SECRET = 'test-webhook-secret-value';

function buildContext(
  headers: Record<string, string | string[]>,
): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        headers,
        rawBody: Buffer.from('payload'),
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
    const ctx = buildContext({ authorization: `Bearer ${SECRET}` });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('should throw UnauthorizedException when Authorization header is absent', () => {
    const ctx = buildContext({});
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('should throw UnauthorizedException for a wrong token', () => {
    const ctx = buildContext({ authorization: 'Bearer wrong-secret' });
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('should throw UnauthorizedException when header is not Bearer format', () => {
    const ctx = buildContext({ authorization: 'Basic dXNlcjpwYXNz' });
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('should throw UnauthorizedException for duplicate headers', () => {
    const ctx = buildContext({ 'x-gitlab-token': ['token1', 'token2'] });
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('should return true for a valid GitLab token', () => {
    const ctx = buildContext({ 'x-gitlab-token': SECRET });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('should throw UnauthorizedException for invalid GitLab token', () => {
    const ctx = buildContext({ 'x-gitlab-token': 'wrong' });
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('should throw UnauthorizedException for empty GitLab token', () => {
    const ctx = buildContext({ 'x-gitlab-token': '   ' });
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('should return true for a valid GitHub signature', () => {
    const hmac = crypto
      .createHmac('sha256', SECRET)
      .update(Buffer.from('payload'))
      .digest('hex');
    const ctx = buildContext({ 'x-hub-signature-256': `sha256=${hmac}` });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('should throw UnauthorizedException for invalid GitHub signature format', () => {
    const ctx = buildContext({ 'x-hub-signature-256': 'sha1=wrong' });
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('should throw UnauthorizedException for incorrect GitHub signature hex length', () => {
    const ctx = buildContext({ 'x-hub-signature-256': `sha256=123` });
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('should throw UnauthorizedException for wrong GitHub signature', () => {
    const wrongHmac = '0'.repeat(64);
    const ctx = buildContext({ 'x-hub-signature-256': `sha256=${wrongHmac}` });
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });
});
