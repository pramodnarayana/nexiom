import { Test, TestingModule } from '@nestjs/testing';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { Reflector } from '@nestjs/core';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';

describe('AuthGuard', () => {
  let guard: AuthGuard;
  let authService: {
    getEnrichedSession: Mock;
    getSessionFromHeaders: Mock;
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthGuard,
        {
          provide: AuthService,
          useValue: {
            getEnrichedSession: vi.fn(),
            getSessionFromHeaders: vi.fn(),
          },
        },
        {
          provide: Reflector,
          useValue: {
            getAllAndOverride: vi.fn(),
          },
        },
      ],
    }).compile();

    guard = module.get<AuthGuard>(AuthGuard);
    authService = module.get<AuthService>(
      AuthService,
    ) as unknown as typeof authService;
  });

  it('should be defined', () => {
    expect(guard).toBeDefined();
  });

  it('should throw UnauthorizedException if no token is found', async () => {
    authService.getSessionFromHeaders.mockResolvedValue(null);

    const mockContext = {
      switchToHttp: () => ({
        getRequest: () => ({
          headers: {},
        }),
      }),
    } as Partial<ExecutionContext>;

    await expect(
      guard.canActivate(mockContext as ExecutionContext),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('should authenticate successfully with a valid session', async () => {
    const mockUser = { id: 'user1', organizationId: 'org1' };
    const mockSession = { token: 'valid-token' };

    // 1. Validate Session from Headers
    authService.getSessionFromHeaders.mockResolvedValue({
      session: mockSession,
      user: { id: 'user1' },
    });

    // 2. Enrich Session
    authService.getEnrichedSession.mockResolvedValue({
      user: mockUser,
      session: mockSession,
    });

    const mockRequest = {
      headers: {},
      user: undefined,
      session: undefined,
    };

    const mockContext = {
      switchToHttp: () => ({
        getRequest: () => mockRequest,
      }),
    } as unknown as ExecutionContext;

    const result = await guard.canActivate(mockContext);

    expect(result).toBe(true);
    expect(authService.getSessionFromHeaders).toHaveBeenCalled();
    expect(authService.getEnrichedSession).toHaveBeenCalledWith('valid-token');
    expect(mockRequest.user).toEqual(mockUser);
    expect(mockRequest.session).toEqual(mockSession);
  });

  it('should throw UnauthorizedException if session is invalid via headers', async () => {
    authService.getSessionFromHeaders.mockResolvedValue(null);

    const mockContext = {
      switchToHttp: () => ({
        getRequest: () => ({
          headers: {},
        }),
      }),
    } as unknown as ExecutionContext;

    await expect(guard.canActivate(mockContext)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('should throw UnauthorizedException if enrichment fails', async () => {
    const mockSession = { token: 'valid-token' };
    authService.getSessionFromHeaders.mockResolvedValue({
      session: mockSession,
      user: { id: 'user1' },
    });
    authService.getEnrichedSession.mockResolvedValue(null);

    const mockContext = {
      switchToHttp: () => ({
        getRequest: () => ({
          headers: {},
        }),
      }),
    } as unknown as ExecutionContext;

    await expect(guard.canActivate(mockContext)).rejects.toThrow(
      UnauthorizedException,
    );
  });
});
