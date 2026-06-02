import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CdcRelayGuard } from './cdc-relay.guard.js';

describe('CdcRelayGuard', () => {
  let guard: CdcRelayGuard;
  let mockConfigService: Partial<ConfigService>;
  let mockExecutionContext: Partial<ExecutionContext>;
  let mockRequest: { headers: Record<string, string> };

  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'production');
    mockConfigService = {
      get: vi.fn().mockImplementation((key: string) => {
        if (key === 'DEBEZIUM_SECRET') return 'test-secret';
        return undefined;
      }),
    };

    mockRequest = {
      headers: {},
    };

    mockExecutionContext = {
      switchToHttp: vi.fn().mockReturnValue({
        getRequest: () => mockRequest,
      }),
    };

    guard = new CdcRelayGuard(mockConfigService as ConfigService);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('allows access when authorization header matches Bearer secret', () => {
    mockRequest.headers.authorization = 'Bearer test-secret';
    expect(guard.canActivate(mockExecutionContext as ExecutionContext)).toBe(
      true,
    );
  });

  it('throws UnauthorizedException when authorization header is missing', () => {
    expect(() =>
      guard.canActivate(mockExecutionContext as ExecutionContext),
    ).toThrow(UnauthorizedException);
  });

  it('throws UnauthorizedException when authorization header is invalid', () => {
    mockRequest.headers.authorization = 'Bearer wrong-secret';
    expect(() =>
      guard.canActivate(mockExecutionContext as ExecutionContext),
    ).toThrow(UnauthorizedException);
  });

  it('throws UnauthorizedException when DEBEZIUM_SECRET is not configured', () => {
    mockConfigService.get = vi.fn().mockReturnValue(undefined);
    expect(() =>
      guard.canActivate(mockExecutionContext as ExecutionContext),
    ).toThrow('DEBEZIUM_SECRET is not configured');
  });
});
