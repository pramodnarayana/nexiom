import { ExecutionContext, InternalServerErrorException } from '@nestjs/common';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { AuthContext, RequestAuthContext } from './auth-context.decorator';
import type { User, Session } from '@nexiom/identity';
import { describe, it, expect } from 'vitest';

// Helper to extract the factory function from a param decorator
function getParamDecoratorFactory(decorator: () => ParameterDecorator) {
  class TestClass {
    testMethod(@decorator() _value: unknown) {}
  }
  const metadata = Reflect.getMetadata(
    ROUTE_ARGS_METADATA,
    TestClass,
    'testMethod',
  ) as Record<
    string,
    { factory: (data: unknown, ctx: ExecutionContext) => unknown }
  >;
  const key = Object.keys(metadata)[0];
  return metadata[key].factory;
}

describe('AuthContext Decorator', () => {
  const mockUser: User = {
    id: 'user-1',
    email: 'test@example.com',
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    role: 'member',
  };

  const mockSession: Session = {
    id: 'sess-1',
    token: 'tok-1',
    userId: 'user-1',
    expiresAt: new Date(Date.now() + 86400000),
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockHeaders = new Headers({ 'content-type': 'application/json' });

  const mockAuthContext: RequestAuthContext = {
    headers: mockHeaders,
    user: mockUser,
    session: mockSession,
  };

  function createMockContext(
    authContext?: RequestAuthContext,
  ): ExecutionContext {
    return {
      switchToHttp: () => ({
        getRequest: () => ({ authContext }),
      }),
    } as unknown as ExecutionContext;
  }

  it('should return the full auth context when no property specified', () => {
    const factory = getParamDecoratorFactory(() => AuthContext());
    const ctx = createMockContext(mockAuthContext);

    const result = factory(undefined, ctx);
    expect(result).toEqual(mockAuthContext);
  });

  it('should return just the user when "user" is specified', () => {
    const factory = getParamDecoratorFactory(() => AuthContext('user'));
    const ctx = createMockContext(mockAuthContext);

    const result = factory('user', ctx);
    expect(result).toEqual(mockUser);
  });

  it('should return just the session when "session" is specified', () => {
    const factory = getParamDecoratorFactory(() => AuthContext('session'));
    const ctx = createMockContext(mockAuthContext);

    const result = factory('session', ctx);
    expect(result).toEqual(mockSession);
  });

  it('should return just the headers when "headers" is specified', () => {
    const factory = getParamDecoratorFactory(() => AuthContext('headers'));
    const ctx = createMockContext(mockAuthContext);

    const result = factory('headers', ctx);
    expect(result).toEqual(mockHeaders);
  });

  it('should throw InternalServerErrorException if authContext is missing', () => {
    const factory = getParamDecoratorFactory(() => AuthContext());
    const ctx = createMockContext(undefined);

    expect(() => factory(undefined, ctx)).toThrow(InternalServerErrorException);
  });
});
