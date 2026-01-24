import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { USER_PROVIDER } from '@nexiom/identity';
import { TenantsService } from '../tenants/tenants.service';
import { InvitationsService } from '../invitations/invitations.service';
import { Request, Response } from 'express';

describe('AuthController', () => {
  let controller: AuthController;
  let module: TestingModule;

  const mockSession = {
    id: 'session-123',
    userId: '123',
    expiresAt: new Date(Date.now() + 86400000),
    token: 'token-123',
    ipAddress: null,
    userAgent: null,
  };

  const mockAuthService = {
    login: jest.fn(),
    createUser: jest.fn(),
    getSessionFromHeaders: jest.fn(),
    getHandler: jest.fn(() => () => {}),
    setPassword: jest.fn(),
    getEnrichedSession: jest.fn(),
  };

  const mockUserProvider = {
    create: jest.fn(),
    findByEmail: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    forceVerifyEmail: jest.fn(),
  };

  const mockTenantsService = {
    provisionTenantForUser: jest.fn(),
  };

  const mockInvitationsService = {
    accept: jest.fn(),
    get: jest.fn(),
  };

  beforeEach(async () => {
    module = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        {
          provide: AuthService,
          useValue: mockAuthService,
        },
        {
          provide: USER_PROVIDER,
          useValue: mockUserProvider,
        },
        {
          provide: TenantsService,
          useValue: mockTenantsService,
        },
        {
          provide: InvitationsService,
          useValue: mockInvitationsService,
        },
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);
    // Ensure we are spying on the correct instance
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const userProvider = module.get(USER_PROVIDER);
    Object.assign(mockUserProvider, userProvider);

    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('provisionTenant', () => {
    it('should provision tenant via TenantsService', async () => {
      const mockRequest = {
        headers: {},
        cookies: {
          'better-auth.session_token': 'valid-token-123',
        },
      } as unknown as Request;

      const mockSessionData = {
        user: { id: 'user-123' },
        session: mockSession,
      };

      mockAuthService.getSessionFromHeaders.mockResolvedValue(mockSessionData);
      mockTenantsService.provisionTenantForUser.mockResolvedValue({
        id: 'org-123',
        name: 'New Org',
      });

      const result = await controller.provisionTenant(mockRequest);

      expect(result).toBeDefined();
      expect(mockTenantsService.provisionTenantForUser).toHaveBeenCalledWith(
        'user-123',
      );
    });
  });
  describe('completeInvite', () => {
    it('should complete invite successfully', async () => {
      mockInvitationsService.get.mockResolvedValue({
        status: 'pending',
        expiresAt: new Date(Date.now() + 10000),
      });
      mockInvitationsService.accept.mockResolvedValue('inv-123');
      const mockUser = { id: 'user-new' };
      mockAuthService.createUser.mockResolvedValue(mockUser);
      // Login mock return
      mockAuthService.login.mockResolvedValue({
        session: { token: 'sess-123' },
        user: mockUser,
        cookie: 'session=123',
      });

      const body = {
        invitationId: 'inv-123',
        email: 'test@example.com',
        password: 'pass',
        firstName: 'Test',
        lastName: 'User',
      };

      const res = { setHeader: jest.fn() } as unknown as Response;

      const result = await controller.completeInvite(body, res);

      expect(result).toBeDefined();
    });

    it('should complete invite for existing unverified user', async () => {
      mockInvitationsService.get.mockResolvedValue({
        status: 'pending',
        expiresAt: new Date(Date.now() + 10000),
      });
      mockInvitationsService.accept.mockResolvedValue('inv-123');
      const mockExistingUser = {
        id: 'user-existing',
        emailVerified: false,
        email: 'test@example.com',
      };
      mockUserProvider.findByEmail.mockResolvedValue(mockExistingUser);
      mockUserProvider.update.mockResolvedValue({
        ...mockExistingUser,
        name: 'Test User',
      });
      mockAuthService.setPassword.mockResolvedValue(undefined); // void

      mockAuthService.login.mockResolvedValue({
        session: { token: 'sess-123' },
        user: mockExistingUser,
        cookie: 'session=123',
      });

      const body = {
        invitationId: 'inv-123',
        email: 'test@example.com',
        password: 'pass',
        firstName: 'Test',
        lastName: 'User',
      };

      const res = { setHeader: jest.fn() } as unknown as Response;

      const result = await controller.completeInvite(body, res);

      expect(result).toBeDefined();
      expect(mockUserProvider.update).toHaveBeenCalledWith('user-existing', {
        name: 'Test User',
      });
      expect(mockAuthService.setPassword).toHaveBeenCalledWith(
        'user-existing',
        'pass',
      );
    });

    it('should rollback user creation if invite accept fails', async () => {
      mockUserProvider.findByEmail.mockResolvedValue(null);
      mockAuthService.createUser.mockResolvedValue({
        id: 'user-fail',
      });
      mockInvitationsService.get.mockResolvedValue({
        status: 'pending',
        expiresAt: new Date(Date.now() + 10000),
      });
      mockInvitationsService.accept.mockRejectedValue(
        new Error('Accept Failed'),
      );

      const body = {
        invitationId: 'inv-fail',
        email: 'test@example.com',
        password: 'pass',
        firstName: 'Test',
        lastName: 'User',
      };

      const res = { setHeader: jest.fn() } as unknown as Response;

      await expect(controller.completeInvite(body, res)).rejects.toThrow(
        'Failed to accept invitation',
      );

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const provider = module.get(USER_PROVIDER);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect(provider.delete).toHaveBeenCalledWith('user-fail');
    });
  });
  describe('betterAuth', () => {
    it('should delegate to authService.getHandler', async () => {
      const mockHandler = jest.fn();
      mockAuthService.getHandler.mockReturnValue(mockHandler);

      const mockResponse = {
        end: jest.fn(),
        setHeader: jest.fn(),
      } as unknown as Response;

      await controller.betterAuth({} as unknown as Request, mockResponse);

      expect(mockAuthService.getHandler).toHaveBeenCalled();
    });
  });

  describe('refreshSession', () => {
    it('should return enriched session', async () => {
      const mockSessionData = {
        session: { token: 'tok-123' },
        user: { id: 'u1' },
      };
      mockAuthService.getSessionFromHeaders.mockResolvedValue(mockSessionData);

      const enriched = { user: { id: 'u1', hasTenant: true } };
      mockAuthService.getEnrichedSession.mockResolvedValue(enriched);

      const req = { headers: {} } as Request;
      const result = await controller.refreshSession(req);

      expect(mockAuthService.getSessionFromHeaders).toHaveBeenCalled();
      expect(mockAuthService.getEnrichedSession).toHaveBeenCalledWith(
        'tok-123',
      );
      expect(result).toEqual(enriched);
    });

    it('should throw UnauthorizedException if no session', async () => {
      mockAuthService.getSessionFromHeaders.mockResolvedValue(null);
      const req = { headers: {} } as Request;
      await expect(controller.refreshSession(req)).rejects.toThrow();
    });
  });
});
