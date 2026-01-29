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

  it('should throw ForbiddenException if user is not a system admin', async () => {
    authService.getSessionFromHeaders.mockResolvedValue({
      session: {} as unknown,
      user: { id: 'user1', systemRole: 'tenant_user' } as unknown,
    });

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
  });

  it('should throw ForbiddenException if user is platform_user (insufficient privileges)', async () => {
    authService.getSessionFromHeaders.mockResolvedValue({
      session: { token: 'valid' },
      user: { id: 'u2', systemRole: 'platform_user' },
    });

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
  });

  it('should allow access if user is system_admin', async () => {
    const mockUser = { id: 'admin1', systemRole: 'platform_admin' };
    authService.getSessionFromHeaders.mockResolvedValue({
      session: {} as unknown,
      user: mockUser as unknown,
    });

    const mockRequest = { headers: {} };
    const mockContext = {
      switchToHttp: () => ({
        getRequest: () => mockRequest,
      }),
    } as ExecutionContext;

    const result = await guard.canActivate(mockContext);

    expect(result).toBe(true);
    expect((mockRequest as unknown as { user: unknown }).user).toEqual(
      mockUser,
    );
  });

  it('should throw ForbiddenException if user has undefined systemRole', async () => {
    authService.getSessionFromHeaders.mockResolvedValue({
      session: {} as unknown,
      user: { id: 'user1', systemRole: 'tenant_user' } as unknown,
    });

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
  });
});
