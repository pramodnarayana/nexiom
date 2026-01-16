/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { AuthGuard } from './auth.guard';
import { IdentityProvider } from './identity-provider.abstract';
import { UnauthorizedException } from '@nestjs/common';
import { ExecutionContext } from '@nestjs/common';

describe('AuthGuard', () => {
  let guard: AuthGuard;
  let identityProvider: jest.Mocked<IdentityProvider>;

  const mockIdentityProvider = {
    getEnrichedSession: jest.fn(),
    createUser: jest.fn(),
    login: jest.fn(),
    validateSession: jest.fn(),
    getSessionFromHeaders: jest.fn(),
    createInvitation: jest.fn(),
    getInvitation: jest.fn(),
    acceptInvitation: jest.fn(),
    getHandler: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthGuard,
        { provide: IdentityProvider, useValue: mockIdentityProvider },
      ],
    }).compile();

    guard = module.get<AuthGuard>(AuthGuard);
    identityProvider = module.get(IdentityProvider);
  });

  it('should be defined', () => {
    expect(guard).toBeDefined();
  });

  it('should throw UnauthorizedException if no token is found', async () => {
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

  it('should authenticate successfully with a valid session', async () => {
    const mockUser = { id: 'user1', organizationId: 'org1' };
    const mockSession = { token: 'valid-token' };

    // 1. Validate Session from Headers
    mockIdentityProvider.getSessionFromHeaders.mockResolvedValue({
      session: mockSession,
      user: { id: 'user1' },
    });

    // 2. Enrich Session
    mockIdentityProvider.getEnrichedSession.mockResolvedValue({
      user: mockUser,
      session: mockSession,
    });

    const mockRequest = {
      headers: {},
      user: undefined,
      session: undefined,
    };

    const mockContext = {
      switchToHttp: () => ({
        getRequest: () => mockRequest,
      }),
    } as unknown as ExecutionContext;

    const result = await guard.canActivate(mockContext);

    expect(result).toBe(true);
    expect(identityProvider.getSessionFromHeaders).toHaveBeenCalled();
    expect(identityProvider.getEnrichedSession).toHaveBeenCalledWith(
      'valid-token',
    );
    expect(mockRequest.user).toEqual(mockUser);
    expect(mockRequest.session).toEqual(mockSession);
  });

  it('should throw UnauthorizedException if session is invalid via headers', async () => {
    mockIdentityProvider.getSessionFromHeaders.mockResolvedValue(null);

    const mockContext = {
      switchToHttp: () => ({
        getRequest: () => ({
          headers: {},
        }),
      }),
    } as unknown as ExecutionContext;

    await expect(guard.canActivate(mockContext)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('should throw UnauthorizedException if enrichment fails', async () => {
    const mockSession = { token: 'valid-token' };
    mockIdentityProvider.getSessionFromHeaders.mockResolvedValue({
      session: mockSession,
      user: { id: 'user1' },
    });
    mockIdentityProvider.getEnrichedSession.mockResolvedValue(null);

    const mockContext = {
      switchToHttp: () => ({
        getRequest: () => ({
          headers: {},
        }),
      }),
    } as unknown as ExecutionContext;

    await expect(guard.canActivate(mockContext)).rejects.toThrow(
      UnauthorizedException,
    );
  });
});
