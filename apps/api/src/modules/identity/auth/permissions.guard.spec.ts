import { PermissionsGuard } from './permissions.guard';
import { Reflector } from '@nestjs/core';
import { ExecutionContext } from '@nestjs/common';
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
            getAllAndOverride: jest.fn(),
          },
        },
      ],
    }).compile();

    guard = module.get(PermissionsGuard);
    reflector = module.get(Reflector);
  });

  const mockContext = (user: { permissions: string[] } | Record<string, any>) =>
    ({
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({
        getRequest: () => ({ user }),
      }),
    }) as unknown as ExecutionContext;

  it('should allow if no permissions required', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(null);
    expect(guard.canActivate(mockContext({}))).toBe(true);
  });

  it('should allow if user has exact permission', () => {
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValue([{ resource: 'users', action: 'manage' }]);
    const user = { permissions: ['users:manage'] };
    expect(guard.canActivate(mockContext(user))).toBe(true);
  });

  it('should deny if user misses permission', () => {
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValue([{ resource: 'users', action: 'manage' }]);
    const user = { permissions: ['users:read'] };
    expect(guard.canActivate(mockContext(user))).toBe(false);
  });

  it('should allow if user has wildcard', () => {
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValue([{ resource: 'users', action: 'manage' }]);
    const user = { permissions: ['*'] };
    expect(guard.canActivate(mockContext(user))).toBe(true);
  });

  it('should allow if user matches one of multiple required permissions', () => {
    // Logic check: guard uses .some()?
    // Code: return requiredPermissions.some(...)
    // So if ANY of the required permissions is present?
    // Decorator stores "required permissions".
    // Usually multiple decorators mean "AND" or "OR"?
    // SetMetadata overrides.
    // If I require multiple permissions (not supported by single decorator call unless array passed).
    // The decorator takes (resource, action). It pushes `{resource, action}` into array?
    // My decorator code: `SetMetadata(PERMISSION_KEY, [{ resource, action }])`
    // So currently only supports ONE requirement per endpoint unless I change usage.
    // But `getAllAndOverride` returns an array.
    // If usage was `@UseGuards...` and Reflector merges metadata? Merge behavior depends.
    // Assuming single requirement for now.

    // But let's test Array behavior just in case.
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([
      { resource: 'users', action: 'read' },
      { resource: 'users', action: 'manage' },
    ]);
    // Guard uses .some(). So if I have ONE of them, I pass.
    // This implies "OR" logic.
    const user = { permissions: ['users:read'] };
    expect(guard.canActivate(mockContext(user))).toBe(true);
  });
});
