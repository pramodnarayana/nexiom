// Local API Constants
// These are owned by the Application and read from the Environment directly.

// Lazy accessors to avoid forcing env vars at module load time
// Use these getters in runtime code (main.ts, services, etc.)
export const getSystemTenantId = (): string => {
  const value = process.env.SYSTEM_TENANT_ID;
  if (!value) {
    throw new Error('Missing required environment variable: SYSTEM_TENANT_ID');
  }
  return value;
};

export const getOwnerRoleId = (): string => {
  const value = process.env.OWNER_ROLE_ID;
  if (!value) {
    throw new Error('Missing required environment variable: OWNER_ROLE_ID');
  }
  return value;
};

export const getAdminRoleId = (): string => {
  const value = process.env.ADMIN_ROLE_ID;
  if (!value) {
    throw new Error('Missing required environment variable: ADMIN_ROLE_ID');
  }
  return value;
};

export const getMemberRoleId = (): string => {
  const value = process.env.MEMBER_ROLE_ID;
  if (!value) {
    throw new Error('Missing required environment variable: MEMBER_ROLE_ID');
  }
  return value;
};

// For scripts that need immediate validation (manage.ts, reset-e2e.ts, etc.)
// Call this function explicitly to throw early if env vars are missing
export const validateRequiredEnv = (): void => {
  getSystemTenantId();
  getOwnerRoleId();
  getAdminRoleId();
  getMemberRoleId();
};

// REQUIRED_* getters - throw if env vars are missing (safer than defaults)
export const getRequiredSystemTenantId = (): string => {
  const value = process.env.SYSTEM_TENANT_ID;
  if (!value)
    throw new Error('Missing required environment variable: SYSTEM_TENANT_ID');
  return value;
};

export const getRequiredOwnerRoleId = (): string => {
  const value = process.env.OWNER_ROLE_ID;
  if (!value)
    throw new Error('Missing required environment variable: OWNER_ROLE_ID');
  return value;
};

export const getRequiredAdminRoleId = (): string => {
  const value = process.env.ADMIN_ROLE_ID;
  if (!value)
    throw new Error('Missing required environment variable: ADMIN_ROLE_ID');
  return value;
};

export const getRequiredMemberRoleId = (): string => {
  const value = process.env.MEMBER_ROLE_ID;
  if (!value)
    throw new Error('Missing required environment variable: MEMBER_ROLE_ID');
  return value;
};

export { ALL_PERMISSIONS } from '@nexiom/identity/src/constants';
