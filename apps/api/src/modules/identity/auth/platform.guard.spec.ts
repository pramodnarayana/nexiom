/* eslint-disable @typescript-eslint/no-unsafe-assignment */

import { Test, TestingModule } from '@nestjs/testing';
import { PlatformGuard } from './platform.guard.js';
import { AuthService } from '@nexiom/auth';
import {
  ForbiddenException,
  UnauthorizedException,
  ExecutionContext,
} from '@nestjs/common';
import { PERMISSION_PROVIDER } from '@nexiom/identity';
import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';

describe('PlatformGuard', () => {
  let guard: PlatformGuard;
  let module: TestingModule;
  let authService: {
    getSessionFromHeaders: Mock;
    hasSystemPermission: Mock;
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    module = await Test.createTestingModule({
      providers: [
        PlatformGuard,
        {
          provide: AuthService,
          useValue: {
            getSessionFromHeaders: vi.fn(),
            hasSystemPermission: vi.fn(),
          },
        },
        {
          provide: PERMISSION_PROVIDER,
          useValue: {
            hasRole: vi.fn(),
          },
        },
      ],
    }).compile();

    guard = module.get<PlatformGuard>(PlatformGuard);
    authService = module.get<AuthService>(AuthService) as any;
  });

  it('should be defined', () => {
    expect(guard).toBeDefined();
  });

  it('should throw UnauthorizedException if session is invalid', async () => {
    authService.getSessionFromHeaders.mockResolvedValue(null);

    const mockContext = {
      switchToHttp: () => ({
        getRequest: () => ({
          headers: {},
        }),
      }),
    } as ExecutionContext;

    await expect(guard.canActivate(mockContext)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('should throw ForbiddenException if user has no system permission', async () => {
    authService.getSessionFromHeaders.mockResolvedValue({
      session: {} as any,
      user: { id: 'u1' } as any,
    });
    authService.hasSystemPermission.mockResolvedValue(false);

    const mockContext = {
      switchToHttp: () => ({
        getRequest: () => ({
          headers: {},
        }),
      }),
    } as ExecutionContext;

    await expect(guard.canActivate(mockContext)).rejects.toThrow(
      ForbiddenException,
    );
    expect(authService.hasSystemPermission).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'u1' }),
      'view',
    );
  });

  it('should allow access if user has system view privileges', async () => {
    const mockUser = { id: 'admin1' };
    const mockSession = { id: 'sess-1', token: 'tok-1' };
    authService.getSessionFromHeaders.mockResolvedValue({
      session: mockSession as any,
      user: mockUser as any,
    });
    authService.hasSystemPermission.mockResolvedValue(true);

    const mockRequest: Record<string, unknown> = { headers: {} };
    const mockContext = {
      switchToHttp: () => ({
        getRequest: () => mockRequest,
      }),
    } as ExecutionContext;

    const result = await guard.canActivate(mockContext);

    expect(result).toBe(true);
    expect(mockRequest.user).toEqual(mockUser);
    expect(mockRequest.authContext).toBeDefined();
    expect(
      (mockRequest.authContext as { headers: Headers }).headers,
    ).toBeInstanceOf(Headers);
    expect((mockRequest.authContext as { user: unknown }).user).toEqual(
      mockUser,
    );
    expect((mockRequest.authContext as { session: unknown }).session).toEqual(
      mockSession,
    );
    expect(authService.hasSystemPermission).toHaveBeenCalledWith(
      mockUser,
      'view',
    );
  });
});
