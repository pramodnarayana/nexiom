import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { IdentityProvider } from './identity-provider.abstract';
import { TenantsService } from '../tenants/tenants.service';
import { InvitationsService } from '../invitations/invitations.service';
import { Request } from 'express';

describe('AuthController', () => {
  let controller: AuthController;

  const mockSession = {
    id: 'session-123',
    userId: '123',
    expiresAt: new Date(Date.now() + 86400000),
    token: 'token-123',
    ipAddress: null,
    userAgent: null,
  };

  const mockBetterAuthIdentityProvider = {
    login: jest.fn(),
    createUser: jest.fn(),
    deleteUser: jest.fn(),
    forceVerifyEmail: jest.fn(),
    validateSession: jest.fn(),
    getSessionFromHeaders: jest.fn(),
    getEnrichedSession: jest.fn(),
    getUserByEmail: jest.fn(),
    getHandler: jest.fn(() => () => {}),
  };

  const mockTenantsService = {
    provisionTenantForUser: jest.fn(),
  };

  const mockInvitationsService = {
    accept: jest.fn(),
    get: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        {
          provide: IdentityProvider,
          useValue: mockBetterAuthIdentityProvider,
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

      mockBetterAuthIdentityProvider.getSessionFromHeaders.mockResolvedValue(
        mockSessionData,
      );
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
      mockBetterAuthIdentityProvider.deleteUser.mockResolvedValue(undefined);
      mockInvitationsService.accept.mockResolvedValue('inv-123');
      const mockUser = { id: 'user-new' };
      mockBetterAuthIdentityProvider.createUser.mockResolvedValue(mockUser);
      // Login mock return
      mockBetterAuthIdentityProvider.login.mockResolvedValue({
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

      /* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument */
      const res = { setHeader: jest.fn() } as any;

      const mockRequest = { headers: {} } as unknown as Request;
      const result = await controller.completeInvite(body, res, mockRequest);
      /* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument */

      expect(result).toBeDefined();
    });

    it('should rollback user creation if invite accept fails', async () => {
      mockBetterAuthIdentityProvider.createUser.mockResolvedValue({
        id: 'user-fail',
      });
      mockInvitationsService.get.mockResolvedValue({
        status: 'pending',
        expiresAt: new Date(Date.now() + 10000),
      });
      mockInvitationsService.accept.mockRejectedValue(
        new Error('Accept Failed'),
      );
      mockBetterAuthIdentityProvider.deleteUser.mockResolvedValue(undefined);

      const body = {
        invitationId: 'inv-fail',
        email: 'test@example.com',
        password: 'pass',
        firstName: 'Test',
        lastName: 'User',
      };

      /* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument */
      const res = { setHeader: jest.fn() } as any;

      const mockRequest = { headers: {} } as unknown as Request;
      await expect(
        controller.completeInvite(body, res, mockRequest),
      ).rejects.toThrow('Failed to accept invitation');
      /* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument */
      expect(mockBetterAuthIdentityProvider.deleteUser).toHaveBeenCalledWith(
        'user-fail',
      );
    });
  });
});
