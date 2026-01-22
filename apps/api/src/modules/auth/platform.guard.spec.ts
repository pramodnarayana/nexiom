/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */

import { Test, TestingModule } from '@nestjs/testing';
import { PlatformGuard } from './platform.guard';
import { IdentityProvider } from './identity-provider.abstract';
import {
  ExecutionContext,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';

describe('PlatformGuard', () => {
  let guard: PlatformGuard;
  let mockAuthProvider: jest.Mocked<IdentityProvider>;

  beforeEach(async () => {
    jest.clearAllMocks();

    mockAuthProvider = {
      getSessionFromHeaders: jest.fn(),
    } as unknown as jest.Mocked<IdentityProvider>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlatformGuard,
        {
          provide: IdentityProvider,
          useValue: mockAuthProvider,
        },
      ],
    }).compile();

    guard = module.get<PlatformGuard>(PlatformGuard);
  });

  it('should be defined', () => {
    expect(guard).toBeDefined();
  });

  it('should throw UnauthorizedException if session is invalid', async () => {
    mockAuthProvider.getSessionFromHeaders.mockResolvedValue(null);

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
    mockAuthProvider.getSessionFromHeaders.mockResolvedValue({
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
    mockAuthProvider.getSessionFromHeaders.mockResolvedValue({
      session: {} as any,
      user: mockUser as any,
    });

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
    mockAuthProvider.getSessionFromHeaders.mockResolvedValue({
      session: {} as any,
      user: mockUser as any,
    });

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
    mockAuthProvider.getSessionFromHeaders.mockResolvedValue({
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
