// Local API Constants
// These are owned by the Application and read from the Environment directly.

// Lazy accessors to avoid forcing env vars at module load time
// Use these getters in runtime code (main.ts, services, etc.)
// Re-export from identity package to avoid duplication
import {
  getSystemTenantId,
  getOwnerRoleId,
  getAdminRoleId,
  getMemberRoleId,
} from '@nexiom/identity';

export { getSystemTenantId, getOwnerRoleId, getAdminRoleId, getMemberRoleId };

// For scripts that need immediate validation (manage.ts, reset-e2e.ts, etc.)
// Call this function explicitly to throw early if env vars are missing
export const validateRequiredEnv = (): void => {
  getSystemTenantId();
  getOwnerRoleId();
  getAdminRoleId();
  getMemberRoleId();
};

// REQUIRED_* getters - aliases for backward compatibility and semantic clarity
// These throw if env vars are missing (same behavior as identity getters)
export const getRequiredSystemTenantId = getSystemTenantId;
export const getRequiredOwnerRoleId = getOwnerRoleId;
export const getRequiredAdminRoleId = getAdminRoleId;
export const getRequiredMemberRoleId = getMemberRoleId;

export { ALL_PERMISSIONS } from '@nexiom/identity/src/constants';
