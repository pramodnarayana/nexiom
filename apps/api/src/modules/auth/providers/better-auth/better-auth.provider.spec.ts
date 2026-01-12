/* eslint-disable @typescript-eslint/unbound-method */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */

import { Test, TestingModule } from '@nestjs/testing';
import { BetterAuthIdentityProvider } from './better-auth.provider';
import { EmailService } from '../../../email/email.service.abstract';
import { TenantsService } from '../../../tenants/tenants.service';
import { DRIZZLE_DB } from '../../../../db/db.provider';

// Mock Better Auth Library
const mockBetterAuth = {
  api: {
    signUpEmail: jest.fn(),
    signInEmail: jest.fn(),
    getSession: jest.fn(),
  },
  handler: (() => {}) as any,
};

jest.mock('better-auth', () => ({
  betterAuth: jest.fn(() => mockBetterAuth),
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
  from: jest.fn().mockReturnThis(), // Added from mock
  query: {
    member: {
      findMany: jest.fn(),
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

    jest.clearAllMocks();
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
      const result = { session: {}, user: {} };
      mockBetterAuth.api.signInEmail.mockResolvedValue(result);

      expect(await provider.login(email, password)).toEqual(result);
    });
  });

  describe('getEnrichedSession', () => {
    it('should return null if validSession returns null', async () => {
      mockBetterAuth.api.getSession.mockResolvedValue(null);
      expect(await provider.getEnrichedSession('bad')).toBeNull();
    });

    it('should return enriched session with org data', async () => {
      const mockSessionData = {
        user: { id: 'user1' },
        session: { token: 'tok' },
      };
      mockBetterAuth.api.getSession.mockResolvedValue(mockSessionData);

      // Mock DB lookup via query builder
      const mockMembership = {
        organizationId: 'org1',
        organization: { name: 'Test Org' },
        role: 'admin',
      };

      // Need to cast to any because we are mocking the deep query object
      mockDb.query.member.findMany.mockResolvedValue([mockMembership]);

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
});
