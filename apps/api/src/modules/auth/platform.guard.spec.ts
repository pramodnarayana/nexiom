/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */

import { Test, TestingModule } from '@nestjs/testing';
import { PlatformGuard } from './platform.guard';
import { AuthService } from './auth.service';
import {
  ExecutionContext,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';

describe('PlatformGuard', () => {
  let guard: PlatformGuard;
  let module: TestingModule;
  let mockAuthService: {
    getSessionFromHeaders: jest.Mock;
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    mockAuthService = {
      getSessionFromHeaders: jest.fn(),
    };

    module = await Test.createTestingModule({
      providers: [
        PlatformGuard,
        {
          provide: AuthService,
          useValue: mockAuthService,
        },
        {
          provide: 'PERMISSION_PROVIDER', // Using string token as exported from package
          useValue: {
            hasRole: jest.fn(),
          },
        },
      ],
    }).compile();

    guard = module.get<PlatformGuard>(PlatformGuard);
  });

  it('should be defined', () => {
    expect(guard).toBeDefined();
  });

  it('should throw UnauthorizedException if session is invalid', async () => {
    mockAuthService.getSessionFromHeaders.mockResolvedValue(null);

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

  it('should throw ForbiddenException if user has no platform role', async () => {
    mockAuthService.getSessionFromHeaders.mockResolvedValue({
      session: {} as any,
      user: { id: 'u1', systemRole: 'tenant_user' } as any,
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

  it('should allow access if user is platform_admin', async () => {
    const mockUser = { id: 'admin1', systemRole: 'platform_admin' };
    mockAuthService.getSessionFromHeaders.mockResolvedValue({
      session: {} as any,
      user: mockUser as any,
    });
    // Mock Permission Provider Success

    const permissionProvider: any = module.get('PERMISSION_PROVIDER');
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    permissionProvider.hasRole.mockResolvedValue(true);

    const mockRequest = { headers: {} };
    const mockContext = {
      switchToHttp: () => ({
        getRequest: () => mockRequest,
      }),
    } as ExecutionContext;

    const result = await guard.canActivate(mockContext);

    expect(result).toBe(true);
    expect((mockRequest as any).user).toEqual(mockUser);
  });

  it('should allow access if user is platform_user', async () => {
    const mockUser = { id: 'user1', systemRole: 'platform_user' };
    mockAuthService.getSessionFromHeaders.mockResolvedValue({
      session: {} as any,
      user: mockUser as any,
    });
    // Mock Permission Provider Success

    const permissionProvider: any = module.get('PERMISSION_PROVIDER');
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    permissionProvider.hasRole.mockResolvedValue(true);

    const mockRequest = { headers: {} };
    const mockContext = {
      switchToHttp: () => ({
        getRequest: () => mockRequest,
      }),
    } as ExecutionContext;

    const result = await guard.canActivate(mockContext);

    expect(result).toBe(true);
    expect((mockRequest as any).user).toEqual(mockUser);
  });

  it('should throw ForbiddenException if user has undefined systemRole', async () => {
    mockAuthService.getSessionFromHeaders.mockResolvedValue({
      session: {} as any,
      user: { id: 'u3' } as any,
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
