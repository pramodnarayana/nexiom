import { PermissionsGuard } from './permissions.guard';
import { Reflector } from '@nestjs/core';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';

describe('PermissionsGuard', () => {
  let guard: PermissionsGuard;
  let reflector: Reflector;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        PermissionsGuard,
        {
          provide: Reflector,
          useValue: {
            getAllAndOverride: vi.fn(),
          },
        },
      ],
    }).compile();

    guard = module.get(PermissionsGuard);
    reflector = module.get(Reflector);
  });

  const mockContext = (
    user: { permissions: string[] } | undefined | Record<string, any>,
  ) =>
    ({
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({
        getRequest: () => ({ user }),
      }),
    }) as unknown as ExecutionContext;

  it('should allow if no permissions required', () => {
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(null);
    expect(guard.canActivate(mockContext({}))).toBe(true);
  });

  it('should allow if user has exact permission', () => {
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue([
      { resource: 'users', action: 'manage' },
    ]);
    const user = { permissions: ['users:manage'] };
    expect(guard.canActivate(mockContext(user))).toBe(true);
  });

  it('should deny if user misses permission', () => {
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue([
      { resource: 'users', action: 'manage' },
    ]);
    const user = { permissions: ['users:read'] };
    expect(() => guard.canActivate(mockContext(user))).toThrow(
      ForbiddenException,
    );
  });

  it('should allow if user has wildcard', () => {
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue([
      { resource: 'users', action: 'manage' },
    ]);
    const user = { permissions: ['*'] };
    expect(guard.canActivate(mockContext(user))).toBe(true);
  });

  it('should allow if user matches one of multiple required permissions', () => {
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue([
      { resource: 'users', action: 'read' },
      { resource: 'users', action: 'manage' },
    ]);
    const user = { permissions: ['users:read'] };
    expect(guard.canActivate(mockContext(user))).toBe(true);
  });

  it('should deny and throw if user is missing', () => {
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue([
      { resource: 'users', action: 'manage' },
    ]);
    expect(() => guard.canActivate(mockContext(undefined))).toThrow(
      'User not authenticated',
    );
  });

  it('should deny if user has no permissions array', () => {
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue([
      { resource: 'users', action: 'manage' },
    ]);
    const user = { permissions: undefined };
    expect(() => guard.canActivate(mockContext(user))).toThrow(
      ForbiddenException,
    );
  });
});
