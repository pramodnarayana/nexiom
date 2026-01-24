import { Test, TestingModule } from '@nestjs/testing';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { UnauthorizedException, ExecutionContext } from '@nestjs/common';

describe('AuthGuard', () => {
  let guard: AuthGuard;
  let mockAuthService: {
    getEnrichedSession: jest.Mock;
    getSessionFromHeaders: jest.Mock;
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    mockAuthService = {
      getEnrichedSession: jest.fn(),
      getSessionFromHeaders: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthGuard,
        { provide: AuthService, useValue: mockAuthService },
      ],
    }).compile();

    guard = module.get<AuthGuard>(AuthGuard);
  });

  it('should be defined', () => {
    expect(guard).toBeDefined();
  });

  it('should throw UnauthorizedException if no token is found', async () => {
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

  it('should authenticate successfully with a valid session', async () => {
    const mockUser = { id: 'user1', organizationId: 'org1' };
    const mockSession = { token: 'valid-token' };

    // 1. Validate Session from Headers
    mockAuthService.getSessionFromHeaders.mockResolvedValue({
      session: mockSession,
      user: { id: 'user1' },
    });

    // 2. Enrich Session
    mockAuthService.getEnrichedSession.mockResolvedValue({
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
    expect(mockAuthService.getSessionFromHeaders).toHaveBeenCalled();
    expect(mockAuthService.getEnrichedSession).toHaveBeenCalledWith(
      'valid-token',
    );
    expect(mockRequest.user).toEqual(mockUser);
    expect(mockRequest.session).toEqual(mockSession);
  });

  it('should throw UnauthorizedException if session is invalid via headers', async () => {
    mockAuthService.getSessionFromHeaders.mockResolvedValue(null);

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
    mockAuthService.getSessionFromHeaders.mockResolvedValue({
      session: mockSession,
      user: { id: 'user1' },
    });
    mockAuthService.getEnrichedSession.mockResolvedValue(null);

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
