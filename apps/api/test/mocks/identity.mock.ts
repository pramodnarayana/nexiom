export const AUTH_PROVIDER = 'AUTH_PROVIDER';
export const USER_PROVIDER = 'USER_PROVIDER';
export const TENANT_PROVIDER = 'TENANT_PROVIDER';
export const PERMISSION_PROVIDER = 'PERMISSION_PROVIDER';
export const EMAIL_PROVIDER = 'EMAIL_PROVIDER';

export const IdentityModule = {
  register: vi.fn(() => ({
    module: class IdentityModuleMock { },
    providers: [],
    exports: [],
  })),
  registerAsync: vi.fn(() => ({
    module: class IdentityModuleMock { },
    providers: [],
    exports: [],
  })),
};

// Schema Mocks (Simple objects to satisfy Drizzle usage in Controller)
export const user = {
  id: 'user.id',
  email: 'user.email',
  createdAt: 'user.createdAt',
  updatedAt: 'user.updatedAt',
  emailVerified: 'user.emailVerified',
  name: 'user.name',
};

export const organization = {
  id: 'organization.id',
  slug: 'organization.slug',
  name: 'organization.name',
  logo: 'organization.logo',
  createdAt: 'organization.createdAt',
  updatedAt: 'organization.updatedAt',
  status: 'organization.status',
  metadata: 'organization.metadata',
};

export const member = {
  id: 'member.id',
  userId: 'member.userId',
  organizationId: 'member.organizationId',
  role: 'member.role',
};

export const invitation = {
  id: 'invitation.id',
  email: 'invitation.email',
  role: 'invitation.role',
  inviterId: 'invitation.inviterId',
  organizationId: 'invitation.organizationId',
  status: 'invitation.status',
  expiresAt: 'invitation.expiresAt',
};

export const session = {
  id: 'session.id',
  userId: 'session.userId',
  token: 'session.token',
};

export const account = {
  id: 'account.id',
  userId: 'account.userId',
  accountId: 'account.accountId',
  providerId: 'account.providerId',
};

export const verification = {
  id: 'verification.id',
};

export const organizationStatusEnum = {
  enumValues: ['active', 'disabled', 'suspended'],
};
