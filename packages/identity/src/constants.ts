export const IDENTITY_OPTIONS = "IDENTITY_OPTIONS";
export const AUTH_PROVIDER = "AUTH_PROVIDER";
export const USER_PROVIDER = "USER_PROVIDER";
export const TENANT_PROVIDER = "TENANT_PROVIDER";
export const PERMISSION_PROVIDER = "PERMISSION_PROVIDER";
export const EMAIL_PROVIDER = "EMAIL_PROVIDER";
export const DATABASE_CONNECTION = "DATABASE_CONNECTION";
export const IDENTITY_DB = "IDENTITY_DB";

// Environment Variables - Strictly required
// Environment Variables - Strictly required
// DEPRECATED: Use Dependency Injection via IDENTITY_OPTIONS
export const SYSTEM_TENANT_ID = process.env.SYSTEM_TENANT_ID || "DEPRECATED";
export const OWNER_ROLE_ID = process.env.OWNER_ROLE_ID || "DEPRECATED";
export const ADMIN_ROLE_ID = process.env.ADMIN_ROLE_ID || "DEPRECATED";
export const MEMBER_ROLE_ID = process.env.MEMBER_ROLE_ID || "DEPRECATED";

// Runtime check removed to allow library usage without env vars (e.g. testing)
