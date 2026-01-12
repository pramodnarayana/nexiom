import { Test } from '@nestjs/testing';
import { InvitationsModule } from './invitations.module';
import { InvitationsService } from './invitations.service';
import { InvitationsController } from './invitations.controller';
import { IdentityProvider } from '../auth/identity-provider.abstract';
import { DRIZZLE_DB } from '../../db/db.provider';
import { BetterAuthIdentityProvider } from '../auth/providers/better-auth/better-auth.provider';

// Mock better-auth to avoid ESM import errors during test
jest.mock('better-auth', () => ({
  betterAuth: jest.fn(),
}));
jest.mock('better-auth/adapters/drizzle', () => ({
  drizzleAdapter: jest.fn(),
}));
jest.mock('better-auth/plugins', () => ({
  organization: jest.fn(),
  admin: jest.fn(),
}));

describe('InvitationsModule', () => {
  beforeAll(() => {
    process.env.DATABASE_URL = 'postgres://test';
    process.env.ALLOWED_ORIGINS = 'http://localhost';
    process.env.BETTER_AUTH_URL = 'http://localhost/api/auth';
  });

  it('should compile the module', async () => {
    const module = await Test.createTestingModule({
      imports: [InvitationsModule],
    })
      .overrideProvider(IdentityProvider)
      .useValue({}) // Mock IdentityProvider abstract
      .overrideProvider(BetterAuthIdentityProvider)
      .useValue({}) // Mock concrete implementation if implicitly required
      .overrideProvider(DRIZZLE_DB)
      .useValue({}) // Mock DB
      .compile();

    expect(module).toBeDefined();
    expect(module.get(InvitationsService)).toBeDefined();
    expect(module.get(InvitationsController)).toBeDefined();
  });
});
