import { Test, TestingModule } from '@nestjs/testing';
import { SystemAdminGuard } from './system-admin.guard';
import { AuthService } from './auth.service';
import {
  UnauthorizedException,
  ForbiddenException,
  ExecutionContext,
} from '@nestjs/common';

describe('SystemAdminGuard', () => {
  let guard: SystemAdminGuard;

  let mockAuthService: {
    getSessionFromHeaders: jest.Mock;
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    mockAuthService = {
      getSessionFromHeaders: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SystemAdminGuard,
        { provide: AuthService, useValue: mockAuthService },
      ],
    }).compile();

    guard = module.get<SystemAdminGuard>(SystemAdminGuard);
  });

  it('should be defined', () => {
    expect(guard).toBeDefined();
  });

  it('should throw UnauthorizedException if session matches no user', async () => {
    mockAuthService.getSessionFromHeaders.mockResolvedValue(null);

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

  it('should throw ForbiddenException if user is not a platform_admin', async () => {
    mockAuthService.getSessionFromHeaders.mockResolvedValue({
      session: { token: 'valid' },
      user: { id: 'u1', systemRole: 'platform_user' },
    });

    const mockContext = {
      switchToHttp: () => ({
        getRequest: () => ({
          headers: {},
        }),
      }),
    } as Partial<ExecutionContext>;

    await expect(
      guard.canActivate(mockContext as ExecutionContext),
    ).rejects.toThrow(ForbiddenException);
  });

  it('should throw ForbiddenException if user is platform_user (insufficient privileges)', async () => {
    mockAuthService.getSessionFromHeaders.mockResolvedValue({
      session: { token: 'valid' },
      user: { id: 'u2', systemRole: 'platform_user' },
    });

    const mockContext = {
      switchToHttp: () => ({
        getRequest: () => ({
          headers: {},
        }),
      }),
    } as Partial<ExecutionContext>;

    await expect(
      guard.canActivate(mockContext as ExecutionContext),
    ).rejects.toThrow(ForbiddenException);
  });

  it('should allow access if user is a platform_admin', async () => {
    const mockUser = { id: 'admin1', systemRole: 'platform_admin' };
    mockAuthService.getSessionFromHeaders.mockResolvedValue({
      session: { token: 'valid' },
      user: mockUser,
    });

    const mockRequest = { headers: {}, user: undefined };
    const mockContext = {
      switchToHttp: () => ({
        getRequest: () => mockRequest,
      }),
    } as Partial<ExecutionContext>;

    const result = await guard.canActivate(mockContext as ExecutionContext);

    expect(result).toBe(true);
    expect(mockRequest.user).toEqual(mockUser);
  });
});
