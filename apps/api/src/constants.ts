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
} from '@nexiom/identity/constants';

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
export {
  getSystemTenantId as getRequiredSystemTenantId,
  getOwnerRoleId as getRequiredOwnerRoleId,
  getAdminRoleId as getRequiredAdminRoleId,
  getMemberRoleId as getRequiredMemberRoleId,
} from '@nexiom/identity/constants';

export {
  ALL_PERMISSIONS,
  isSystemPermission,
} from '@nexiom/identity/constants';
