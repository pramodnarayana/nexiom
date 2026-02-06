// Local API Constants
// These are owned by the Application and read from the Environment directly.

export const SYSTEM_TENANT_ID = process.env.SYSTEM_TENANT_ID;
export const OWNER_ROLE_ID = process.env.OWNER_ROLE_ID;
export const ADMIN_ROLE_ID = process.env.ADMIN_ROLE_ID;
export const MEMBER_ROLE_ID = process.env.MEMBER_ROLE_ID;

// Validation for scripts/standalone usage

if (!SYSTEM_TENANT_ID || !OWNER_ROLE_ID || !ADMIN_ROLE_ID || !MEMBER_ROLE_ID) {
  throw new Error(
    'Missing Identity Environment Variables (SYSTEM_TENANT_ID, OWNER_ROLE_ID, ADMIN_ROLE_ID, MEMBER_ROLE_ID)',
  );
}

export const REQUIRED_SYSTEM_TENANT_ID = SYSTEM_TENANT_ID;
export const REQUIRED_OWNER_ROLE_ID = OWNER_ROLE_ID;
export const REQUIRED_ADMIN_ROLE_ID = ADMIN_ROLE_ID;
export const REQUIRED_MEMBER_ROLE_ID = MEMBER_ROLE_ID;
