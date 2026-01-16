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
    validateSession: jest.fn(),
    getSessionFromHeaders: jest.fn(),
    getEnrichedSession: jest.fn(),
    getHandler: jest.fn(() => () => {}),
  };

  const mockTenantsService = {
    provisionTenantForUser: jest.fn(),
  };

  const mockInvitationsService = {
    accept: jest.fn(),
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
});
