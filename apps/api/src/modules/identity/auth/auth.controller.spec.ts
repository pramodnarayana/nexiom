/* eslint-disable @typescript-eslint/no-unused-vars */
import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller.js';
import { AuthService, type RequestAuthContext } from '@soopa/auth';
import { USER_PROVIDER, TENANT_PROVIDER } from '@soopa/identity';
import type { User, Session } from '@soopa/identity';
import { InvitationsService } from '../invitations/invitations.service.js';
import { Request, Response } from 'express';
import { CompleteInvite } from '../users/users.validation.js';

vi.mock('better-auth/node', () => ({
  toNodeHandler: vi
    .fn()
    .mockImplementation((_h: any) => (_req: any, res: any) => res.end()),
}));

describe('AuthController', () => {
  let controller: AuthController;
  let module: TestingModule;

  const mockAuthService = {
    login: vi.fn(),
    createUser: vi.fn(),
    getSessionFromHeaders: vi.fn(),
    getHandler: vi.fn(() => () => {}),
    setPassword: vi.fn(),
    getEnrichedSession: vi.fn(),
    resendVerificationEmail: vi.fn(),
  };

  const mockUserProvider = {
    create: vi.fn(),
    findByEmail: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    forceVerifyEmail: vi.fn(),
  };

  const mockTenantProvider = {
    provisionTenantForUser: vi.fn(),
  };

  const mockInvitationsService = {
    accept: vi.fn(),
    get: vi.fn(),
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
          provide: TENANT_PROVIDER,
          useValue: mockTenantProvider,
        },
        {
          provide: InvitationsService,
          useValue: mockInvitationsService,
        },
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);
    vi.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('login', () => {
    it('should set cookie if loginCookie is present', async () => {
      mockAuthService.login.mockResolvedValue({
        cookie: 'test-cookie=123',
        session: { id: 's1' },
        user: { id: 'u1' },
      });
      const res = { setHeader: vi.fn() } as any;
      const result = await controller.login(
        { email: 'test@example.com', password: 'password' },
        res,
      );

      expect(result.session.id).toBe('s1');
      expect(res.setHeader).toHaveBeenCalledWith(
        'Set-Cookie',
        'test-cookie=123',
      );
    });

    it('should not set cookie if loginCookie is absent', async () => {
      mockAuthService.login.mockResolvedValue({
        session: { id: 's1' },
        user: { id: 'u1' },
      });
      const res = { setHeader: vi.fn() } as any;
      const result = await controller.login(
        { email: 'test@example.com', password: 'password' },
        res,
      );

      expect(result.session.id).toBe('s1');
      expect(res.setHeader).not.toHaveBeenCalled();
    });
  });

  describe('signup', () => {
    it('should return user from registerUser', async () => {
      (mockAuthService as any).registerUser = vi
        .fn()
        .mockResolvedValue({ id: 'u1' });
      const result = await controller.signup({
        email: 'test@example.com',
        password: 'password',
        firstName: 'John',
        lastName: 'Doe',
        role: 'member',
      } as any);
      expect(result.id).toBe('u1');
    });
  });

  describe('provisionTenant', () => {
    it('should provision tenant via TenantsService', async () => {
      const mockUser = { id: 'user-123' } as User;

      mockTenantProvider.provisionTenantForUser.mockResolvedValue({
        id: 'org-123',
        name: 'New Org',
      });

      const result = await controller.provisionTenant(mockUser);

      expect(result).toBeDefined();
      expect(mockTenantProvider.provisionTenantForUser).toHaveBeenCalledWith(
        'user-123',
      );
    });
  });

  describe('completeInvite', () => {
    it('should throw BadRequestException if invitation not found', async () => {
      mockInvitationsService.get.mockResolvedValue(null);
      const body = { invitationId: 'bad-id' } as unknown as CompleteInvite;
      const res = { setHeader: vi.fn() } as any;
      await expect(controller.completeInvite(body, res)).rejects.toThrow(
        'Invalid Invitation ID',
      );
    });

    it('should throw BadRequestException if invitation is not pending', async () => {
      mockInvitationsService.get.mockResolvedValue({
        status: 'accepted',
        expiresAt: new Date(Date.now() + 10000), // Valid expiration
      });
      const body = { invitationId: 'exp-id' } as unknown as CompleteInvite;
      const res = { setHeader: vi.fn() } as any;
      await expect(controller.completeInvite(body, res)).rejects.toThrow(
        'Invitation is no longer pending/valid',
      );
    });

    it('should throw BadRequestException if invitation has expired', async () => {
      mockInvitationsService.get.mockResolvedValue({
        status: 'pending',
        expiresAt: new Date(Date.now() - 10000), // Expired
      });
      const body = { invitationId: 'exp-id' } as unknown as CompleteInvite;
      const res = { setHeader: vi.fn() } as any;
      await expect(controller.completeInvite(body, res)).rejects.toThrow(
        'Invitation has expired',
      );
    });

    it('should throw BadRequestException if user already verified', async () => {
      mockInvitationsService.get.mockResolvedValue({
        status: 'pending',
        expiresAt: new Date(Date.now() + 10000),
      });
      mockUserProvider.findByEmail.mockResolvedValue({
        id: 'u1',
        emailVerified: true,
      });
      const body = {
        invitationId: 'inv-1',
        email: 'test@example.com',
      } as unknown as CompleteInvite;
      const res = { setHeader: vi.fn() } as any;
      await expect(controller.completeInvite(body, res)).rejects.toThrow(
        'User is already registered',
      );
    });
    it('should complete invite successfully', async () => {
      mockUserProvider.findByEmail.mockResolvedValue(null);
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

      const res = { setHeader: vi.fn() } as any;

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

      const res = { setHeader: vi.fn() } as any;

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

      const res = { setHeader: vi.fn() } as any;

      await expect(controller.completeInvite(body, res)).rejects.toThrow(
        'Failed to accept invitation',
      );

      expect(mockUserProvider.delete).toHaveBeenCalledWith('user-fail');
    });
  });
  describe('resendVerification', () => {
    it('should satisfy coverage by handling success', async () => {
      mockAuthService.resendVerificationEmail = vi
        .fn()
        .mockResolvedValue(undefined);
      const result = await controller.resendVerification({
        email: 'test@example.com',
      });
      expect(result).toEqual({
        message: 'Verification email sent successfully',
      });
    });

    it('should satisfy coverage by handling error', async () => {
      mockAuthService.resendVerificationEmail = vi
        .fn()
        .mockRejectedValue(new Error('Mail Error'));
      await expect(
        controller.resendVerification({ email: 'test@example.com' }),
      ).rejects.toThrow('Mail Error');
    });

    it('should throw when service receives empty email', async () => {
      // Mock console.error to keep test output clean
      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      // Mock service to throw if email is missing (simulating service validation)
      mockAuthService.resendVerificationEmail = vi
        .fn()
        .mockImplementation((email) => {
          if (!email) throw new Error('Email is required');
          return Promise.resolve();
        });

      await expect(
        controller.resendVerification({ email: '' }),
      ).rejects.toThrow();

      consoleSpy.mockRestore();
    });
  });

  describe('betterAuth', () => {
    it('should delegate to toNodeHandler when handler is a function', async () => {
      // Create a dummy handler
      const mockHandler = vi.fn();
      mockAuthService.getHandler.mockReturnValue(mockHandler);

      // Mock toNodeHandler is hoisted to the top level

      const { toNodeHandler } = await import('better-auth/node');

      const mockResponse = {
        end: vi.fn(),
        setHeader: vi.fn(),
        getHeader: vi.fn(),
        getHeaders: vi.fn(),
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
        writable: true,
        headersSent: false,
      } as any;

      const mockRequest = {
        headers: {},
        method: 'POST',
        path: '/api/auth/signin/email-password',
        url: '/api/auth/signin/email-password',
        socket: { encrypted: false },
      } as unknown as Request;

      await controller.betterAuth(mockRequest, mockResponse);

      expect(mockAuthService.getHandler).toHaveBeenCalled();
    });

    it('should return 500 if handler is not a function', async () => {
      mockAuthService.getHandler.mockReturnValue(null as any);
      const mockResponse = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      } as any;
      const mockRequest = {
        method: 'GET',
        path: '/test',
      } as unknown as Request;

      await controller.betterAuth(mockRequest, mockResponse);
      expect(mockResponse.status).toHaveBeenCalledWith(500);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'Invalid auth handler',
      });
    });
  });

  describe('refreshSession', () => {
    it('should return enriched session directly from context', () => {
      const mockSession = {
        id: 'session-123',
        userId: 'u1',
        token: 'tok-123',
        expiresAt: new Date(),
        ipAddress: '127.0.0.1',
        userAgent: 'test-agent',
        createdAt: new Date(),
        updatedAt: new Date(),
      } as Session;

      const mockUser = {
        id: 'u1',
        email: 'test@example.com',
      } as User;

      const mockContext = {
        session: mockSession,
        user: mockUser,
      } as unknown as RequestAuthContext;

      const result = controller.refreshSession(mockContext);

      expect(result).toEqual({
        session: mockSession,
        user: mockUser,
      });
      expect(mockAuthService.getEnrichedSession).not.toHaveBeenCalled();
    });
  });
});
