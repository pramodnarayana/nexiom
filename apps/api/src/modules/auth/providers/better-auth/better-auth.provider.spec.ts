/* eslint-disable @typescript-eslint/unbound-method */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */

import { Test, TestingModule } from '@nestjs/testing';
import { BetterAuthIdentityProvider } from './better-auth.provider';
import { EmailService } from '../../../email/email.service.abstract';
import { TenantsService } from '../../../tenants/tenants.service';
import { DRIZZLE_DB } from '../../../../db/db.provider';
import { organization } from 'better-auth/plugins';

// Mock Better Auth Library
const mockBetterAuth = {
  api: {
    signUpEmail: jest.fn(),
    signInEmail: jest.fn(),
    getSession: jest.fn(),
    createInvitation: jest.fn(),
    getInvitation: jest.fn(),
    acceptInvitation: jest.fn(),
  },
  handler: (() => {}) as any,
};

const mockBetterAuthFactory = jest.fn((config) => {
  // Store config globally or on the mock so we can access it in tests
  (mockBetterAuthFactory as any).lastConfig = config;
  return mockBetterAuth;
});

jest.mock('better-auth', () => ({
  betterAuth: (config: any) => mockBetterAuthFactory(config),
}));

jest.mock('better-auth/adapters/drizzle', () => ({
  drizzleAdapter: jest.fn(),
}));

jest.mock('better-auth/plugins', () => ({
  organization: jest.fn(),
  admin: jest.fn(),
}));

// Mock Drizzle
const mockDb = {
  insert: jest.fn().mockReturnThis(),
  values: jest.fn().mockReturnThis(),
  select: jest.fn().mockReturnThis(),
  from: jest.fn().mockReturnThis(),
  query: {
    member: {
      findMany: jest.fn(),
    },
    session: {
      findFirst: jest.fn(),
    },
    user: {
      findFirst: jest.fn(),
    },
  },
};

jest.mock('drizzle-orm/node-postgres', () => ({
  drizzle: jest.fn(() => mockDb),
}));

jest.mock('pg', () => {
  const mPool = {
    connect: jest.fn(),
    query: jest.fn(),
    end: jest.fn(),
  };
  return { Pool: jest.fn(() => mPool) };
});

describe('BetterAuthIdentityProvider', () => {
  let provider: BetterAuthIdentityProvider;
  let tenantsService: TenantsService;

  const mockEmailService = {
    sendEmail: jest.fn(),
  };

  const mockTenantsService = {
    createTenant: jest.fn(),
  };

  beforeAll(() => {
    process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test';
    process.env.ALLOWED_ORIGINS = 'http://localhost:3000';
    process.env.BETTER_AUTH_URL = 'http://localhost:3000/api/auth';
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BetterAuthIdentityProvider,
        { provide: EmailService, useValue: mockEmailService },
        { provide: TenantsService, useValue: mockTenantsService },
        { provide: DRIZZLE_DB, useValue: mockDb },
      ],
    }).compile();

    provider = module.get<BetterAuthIdentityProvider>(
      BetterAuthIdentityProvider,
    );
    tenantsService = module.get<TenantsService>(TenantsService);
  });

  it('should be defined', () => {
    expect(provider).toBeDefined();
  });

  describe('createUser', () => {
    it('should sign up user via better-auth api', async () => {
      const user = {
        email: 'test@example.com',
        password: 'password',
        firstName: 'Test',
        lastName: 'User',
        role: 'user' as const,
      };
      const mockUser = { id: '123', email: 'test@example.com' };

      mockBetterAuth.api.signUpEmail.mockResolvedValue({ user: mockUser });

      const result = await provider.createUser(user);

      expect(mockBetterAuth.api.signUpEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            email: user.email,
            name: 'Test User',
          }),
        }),
      );
      expect(result).toEqual(mockUser);
    });

    it('should delegate organization creation to TenantsService', async () => {
      const user = {
        email: 'ceo@corp.com',
        password: 'password',
        companyName: 'Corp Inc',
        role: 'admin' as const,
      };
      const mockUser = { id: 'ceo1' };
      mockBetterAuth.api.signUpEmail.mockResolvedValue({ user: mockUser });

      await provider.createUser(user);

      expect(tenantsService.createTenant).toHaveBeenCalledWith(
        'ceo1',
        'Corp Inc',
      );
    });
  });

  describe('login', () => {
    it('should call signInEmail', async () => {
      const email = 'test@example.com';
      const password = 'pass';
      const mockResponse = {
        token: 'token-123',
        user: { id: 'u1' },
      };

      mockBetterAuth.api.signInEmail.mockResolvedValue({
        ok: true,
        headers: new Headers(),
        json: () => Promise.resolve(mockResponse),
      });

      mockDb.query.session.findFirst.mockResolvedValue({ token: 'token-123' });
      mockDb.query.user.findFirst.mockResolvedValue({
        id: 'u1',
        systemRole: 'user',
      });

      const result = await provider.login(email, password);

      expect(result.session).toBeDefined();
      expect(result.user).toBeDefined();
    });
  });

  describe('getEnrichedSession', () => {
    it('should return null if validateSession finds no session in DB', async () => {
      // Mock DB query to return null
      const findFirstSpy = jest
        .spyOn(provider['db'].query.session, 'findFirst')
        .mockResolvedValue(null as any);

      const result = await provider.validateSession('invalid-token');
      expect(result).toBeNull();
      findFirstSpy.mockRestore();
    });

    it('should return null if validateSession finds expired session', async () => {
      // Mock DB return with past expiresAt
      const expiredSession = {
        expiresAt: new Date(Date.now() - 10000), // Past
      };
      const findFirstSpy = jest
        .spyOn(provider['db'].query.session, 'findFirst')
        .mockResolvedValue(expiredSession as any);

      const result = await provider.validateSession('expired-token');
      expect(result).toBeNull();
      findFirstSpy.mockRestore();
    });

    it('should return null if validSession returns null', async () => {
      mockBetterAuth.api.getSession.mockResolvedValue(null);
      // Ensure DB also returns null for session
      mockDb.query.session.findFirst.mockResolvedValue(null);
      expect(await provider.getEnrichedSession('bad')).toBeNull();
    });

    it('should return enriched session with org data', async () => {
      const mockSessionData = {
        user: { id: 'user1' },
        session: { token: 'tok' },
      };
      mockBetterAuth.api.getSession.mockResolvedValue(mockSessionData);

      // Mock DB lookups
      mockDb.query.session.findFirst.mockResolvedValue({
        token: 'tok',
        userId: 'user1',
      });
      mockDb.query.user.findFirst.mockResolvedValueOnce({
        id: 'user1',
        systemRole: 'user',
      }); // For validateSession user fetch

      const mockMembership = {
        organizationId: 'org1',
        organization: { name: 'Test Org' },
        role: 'admin',
      };

      mockDb.query.member.findMany.mockResolvedValue([mockMembership]);
      // Mock user again for getEnrichedSession's system role fetch
      mockDb.query.user.findFirst.mockResolvedValueOnce({
        id: 'user1',
        systemRole: 'user',
      });

      const result = await provider.getEnrichedSession('tok');

      expect(result?.user).toEqual(
        expect.objectContaining({
          hasTenant: true,
          organizationName: 'Test Org',
          roles: ['admin'],
        }),
      );
    });
  });

  describe('createInvitation', () => {
    it('should throw error if organizationId is missing', async () => {
      await expect(
        provider.createInvitation({
          email: 'test@example.com',
          role: 'user',
          organizationId: null,
          inviterId: 'inviter-123',
        }),
      ).rejects.toThrow('System-level invites');
    });

    it('should call createInvitation api with correct payload', async () => {
      mockBetterAuth.api.createInvitation = jest.fn().mockResolvedValue({
        invitation: { id: 'inv-123' },
      });

      const payload = {
        email: 'test@example.com',
        role: 'user',
        organizationId: 'org-123',
        inviterId: 'inviter-123',
        expiresIn: 3600,
      };

      await provider.createInvitation(payload);

      expect(mockBetterAuth.api.createInvitation).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            email: payload.email,
            role: payload.role,
            organizationId: payload.organizationId,
            inviterId: payload.inviterId,
          }),
        }),
      );
    });
  });

  describe('getInvitation', () => {
    it('should call getInvitation api', async () => {
      mockBetterAuth.api.getInvitation = jest.fn().mockResolvedValue({});
      await provider.getInvitation('inv-123');
      expect(mockBetterAuth.api.getInvitation).toHaveBeenCalledWith({
        query: { id: 'inv-123' },
      });
    });
  });

  describe('acceptInvitation', () => {
    it('should call acceptInvitation api', async () => {
      mockBetterAuth.api.acceptInvitation = jest.fn().mockResolvedValue({});
      await provider.acceptInvitation('inv-123', 'user-123');
      expect(mockBetterAuth.api.acceptInvitation).toHaveBeenCalledWith({
        body: { invitationId: 'inv-123' },
      });
    });
  });

  describe('Email Callbacks', () => {
    it('should send verification email', async () => {
      const capturedConfig = mockBetterAuthFactory.mock.calls[0]?.[0];
      const sendVerificationEmail =
        capturedConfig?.emailVerification?.sendVerificationEmail;
      if (!sendVerificationEmail)
        throw new Error('sendVerificationEmail callback not found');
      const user = { email: 'test@example.com' };
      const url = 'http://verify.com';

      await sendVerificationEmail({ user, url });

      expect(mockEmailService.sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: user.email,
          text: expect.stringContaining(url),
        }),
      );
    });

    it('should send invitation email', async () => {
      const orgConfig = (organization as jest.Mock).mock.calls[0][0];
      const sendInvitationEmail = orgConfig.sendInvitationEmail;

      const data = {
        email: 'invite@test.com',
        organization: { name: 'Test Org' },
        invitation: { id: 'inv-123' },
      };

      await sendInvitationEmail(data);

      expect(mockEmailService.sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: data.email,
          subject: expect.stringContaining('invited'),
          text: expect.stringContaining(
            '/invite/accept?id=inv-123', // Matches partial URL since env var is not set in test to frontend
          ),
        }),
      );
    });
  });

  describe('Error Handling', () => {
    it('should throw error if createUser fails', async () => {
      mockBetterAuth.api.signUpEmail.mockRejectedValue(new Error('Auth Error'));
      await expect(
        provider.createUser({
          email: 'bad@example.com',
          password: 'pass',
          role: 'user',
        }),
      ).rejects.toThrow('Auth Error');
    });

    it('should throw error if login fails (missing password)', async () => {
      await expect(provider.login('email', undefined)).rejects.toThrow(
        'Password is required',
      );
    });
  });
});
