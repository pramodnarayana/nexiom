export const IDENTITY_OPTIONS = "IDENTITY_OPTIONS";
export const AUTH_PROVIDER = "AUTH_PROVIDER";
export const USER_PROVIDER = "USER_PROVIDER";
export const TENANT_PROVIDER = "TENANT_PROVIDER";
export const PERMISSION_PROVIDER = "PERMISSION_PROVIDER";
export const EMAIL_PROVIDER = "EMAIL_PROVIDER";
export const DATABASE_CONNECTION = "DATABASE_CONNECTION";
export const IDENTITY_DB = "IDENTITY_DB";
export const BETTER_AUTH_CONFIG = "BETTER_AUTH_CONFIG";

// Environment Variables - Strictly required
// Use Dependency Injection via IDENTITY_OPTIONS where possible.
const getEnv = (key: string): string => {
  const val = process.env[key];
  if (!val) {
    throw new Error(
      `Environment variable ${key} is missing in Identity constants`,
    );
  }
  return val;
};

export const getSystemTenantId = () => getEnv("SYSTEM_TENANT_ID");
export const getOwnerRoleId = () => getEnv("OWNER_ROLE_ID");
export const getAdminRoleId = () => getEnv("ADMIN_ROLE_ID");
export const getMemberRoleId = () => getEnv("MEMBER_ROLE_ID");

// Backwards compatibility for usage in tests or where lazy access is needed
// Note: These will now throw AT RUNTIME when accessed if env is missing, rather than being "undefined" or "DEPRECATED" string.
// To support specific consumers that import * as constants, we might keep them as properties but they are effectively evaluated on import if we use const x = ...
// EXCEPT if we make them Getters. But imports are bindings.
// If I change `export const SYSTEM_TENANT_ID` to a getter function, I break consumers expecting a string.
// User said: "export the raw undefined values and audit callers" OR "implement a fail-fast getter pattern".
// If I assume consumers are refactored to use injection (Round 6), then `constants.ts` is mostly for:
// 1. `PermissionSeeder` (uses local config now).
// 2. `reset-e2e.ts` (API uses its own constants).
// 3. `drizzle-permission.adapter.spec.ts` (Imported directly).
// So I will convert them to functions `getSystemTenantId()` and update consumers to call the function.

// Runtime check removed to allow library usage without env vars (e.g. testing)
