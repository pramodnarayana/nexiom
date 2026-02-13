import { Test, TestingModule } from '@nestjs/testing';
import { SystemAdminGuard } from './system-admin.guard';
import { AuthService } from './auth.service';
import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';

describe('SystemAdminGuard', () => {
  let guard: SystemAdminGuard;
  let authService: {
    getSessionFromHeaders: Mock;
    hasSystemPermission: Mock;
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SystemAdminGuard,
        {
          provide: AuthService,
          useValue: {
            getSessionFromHeaders: vi.fn(),
            hasSystemPermission: vi.fn(),
          },
        },
      ],
    }).compile();

    guard = module.get<SystemAdminGuard>(SystemAdminGuard);
    authService = module.get<AuthService>(
      AuthService,
    ) as unknown as typeof authService;
  });

  it('should be defined', () => {
    expect(guard).toBeDefined();
  });

  it('should throw UnauthorizedException if session is invalid via headers', async () => {
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

  it('should throw ForbiddenException if user lacks manage privileges', async () => {
    authService.getSessionFromHeaders.mockResolvedValue({
      session: {} as unknown,
      user: { id: 'user1' } as unknown,
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
      expect.objectContaining({ id: 'user1' }),
      'manage',
    );
  });

  it('should allow access if user has manage privileges', async () => {
    const mockUser = { id: 'admin1' };
    const mockSession = { id: 'sess-1', token: 'tok-1' };
    authService.getSessionFromHeaders.mockResolvedValue({
      session: mockSession as unknown,
      user: mockUser as unknown,
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
      'manage',
    );
  });
});
