import { Test, TestingModule } from '@nestjs/testing';
import { SystemAdminGuard } from './system-admin.guard';
import { IdentityProvider } from './identity-provider.abstract';
import { UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { ExecutionContext } from '@nestjs/common';

describe('SystemAdminGuard', () => {
  let guard: SystemAdminGuard;
  // identityProvider = module.get(IdentityProvider);

  const mockIdentityProvider = {
    getSessionFromHeaders: jest.fn(),
    getEnrichedSession: jest.fn(),
    login: jest.fn(),
    createUser: jest.fn(),
    validateSession: jest.fn(),
    createInvitation: jest.fn(),
    getInvitation: jest.fn(),
    acceptInvitation: jest.fn(),
    getHandler: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SystemAdminGuard,
        { provide: IdentityProvider, useValue: mockIdentityProvider },
      ],
    }).compile();

    guard = module.get<SystemAdminGuard>(SystemAdminGuard);
    // identityProvider = module.get(IdentityProvider);
  });

  it('should be defined', () => {
    expect(guard).toBeDefined();
  });

  it('should throw UnauthorizedException if session matches no user', async () => {
    mockIdentityProvider.getSessionFromHeaders.mockResolvedValue(null);

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
    mockIdentityProvider.getSessionFromHeaders.mockResolvedValue({
      session: { token: 'valid' },
      user: { id: 'u1', systemRole: 'user' },
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
    mockIdentityProvider.getSessionFromHeaders.mockResolvedValue({
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
    mockIdentityProvider.getSessionFromHeaders.mockResolvedValue({
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
