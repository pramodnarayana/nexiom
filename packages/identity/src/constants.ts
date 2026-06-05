export const IDENTITY_OPTIONS = "IDENTITY_OPTIONS";
export const AUTH_PROVIDER = "AUTH_PROVIDER";
export const USER_PROVIDER = "USER_PROVIDER";
export const TENANT_PROVIDER = "TENANT_PROVIDER";
export const PERMISSION_PROVIDER = "PERMISSION_PROVIDER";
export const EMAIL_PROVIDER = "EMAIL_PROVIDER";
export const IDENTITY_DB = "IDENTITY_DB";
export const BETTER_AUTH_CONFIG = "BETTER_AUTH_CONFIG";
export const ROLE_PROVIDER = "ROLE_PROVIDER";
export const IDENTITY_EVENT_PUBLISHER = "IDENTITY_EVENT_PUBLISHER";

export const ALL_PERMISSIONS = [
  "users:read",
  "users:create",
  "users:update",
  "users:delete",
  "users:manage",
  "tenants:read",
  "tenants:create",
  "tenants:update",
  "tenants:delete",
  "tenants:manage",
  "dashboard:read",
  "admin_dashboard:view",
  "settings:manage",
  "settings:read",
  // System-level user management (for admin/users resource)
  "system_users:read",
  "system_users:create",
  "system_users:update",
  "system_users:delete",
  "system_users:manage",
  // System-level tenant management (for admin/tenants resource)
  "system_tenants:read",
  "system_tenants:create",
  "system_tenants:update",
  "system_tenants:delete",
  "system_tenants:manage",
  "roles:read",
  "invitations:read",
  "invitations:create",
  "workspaces:read",
  "workspaces:manage",
  "stitches:read",
  "stitches:manage",
] as const;

export enum RoleScope {
  System = "system",
  Organization = "organization",
}

export enum Role {
  Owner = "owner",
  Admin = "admin",
  Member = "member",
}

export type PermissionType = (typeof ALL_PERMISSIONS)[number];

const SYSTEM_PERMISSIONS = new Set(
  ALL_PERMISSIONS.filter(
    (p) => p.startsWith("system_") || p.startsWith("admin_dashboard:"),
  ),
);

export const isSystemPermission = (permission: string): boolean =>
  SYSTEM_PERMISSIONS.has(permission as PermissionType);

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

// Runtime check removed to allow library usage without env vars (e.g. testing)
