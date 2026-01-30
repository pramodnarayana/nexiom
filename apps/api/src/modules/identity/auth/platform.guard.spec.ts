/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */

import { Test, TestingModule } from '@nestjs/testing';
import { PlatformGuard } from './platform.guard';
import { AuthService } from './auth.service';
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
    authService.getSessionFromHeaders.mockResolvedValue({
      session: {} as any,
      user: mockUser as any,
    });
    authService.hasSystemPermission.mockResolvedValue(true);

    const mockRequest = { headers: {} };
    const mockContext = {
      switchToHttp: () => ({
        getRequest: () => mockRequest,
      }),
    } as ExecutionContext;

    const result = await guard.canActivate(mockContext);

    expect(result).toBe(true);
    expect((mockRequest as any).user).toEqual(mockUser);
    expect(authService.hasSystemPermission).toHaveBeenCalledWith(
      mockUser,
      'view',
    );
  });
});
