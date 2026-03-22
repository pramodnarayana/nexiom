/**
 * Authorization Resource Constants
 * Used for PBAC checks.
 */
export const Resources = {
    ADMIN_DASHBOARD: 'admin_dashboard',
    DASHBOARD: 'dashboard',
    USERS: 'users',
    TENANTS: 'tenants',
    SETTINGS: 'settings',
} as const;

/**
 * Authorization Action Constants
 * Used for PBAC checks.
 */
export const Actions = {
    VIEW: 'view',
    READ: 'read',
    CREATE: 'create',
    UPDATE: 'update',
    DELETE: 'delete',
    MANAGE: 'manage',
} as const;

/**
 * Role Constants
 * Used for UI logic and permission checks.
 */
export const ROLES = {
    OWNER: 'owner',
    ADMIN: 'admin',
    MEMBER: 'member',
} as const;

/**
 * Application Route Constants
 * Single source of truth for navigation paths.
 */
export const AppRoutes = {
    ADMIN: {
        ROOT: '/admin',
        DASHBOARD: '/admin/dashboard',
        USERS: '/admin/users',
        TENANTS: '/admin/tenants',
    },
    TENANT: {
        ROOT: '/dashboard',
        WORKSPACES: '/dashboard/workspaces',
        PROFILE: '/settings/profile',
    },
    AUTH: {
        LOGIN: '/login',
        SIGNUP: '/signup',
        INVITE_ACCEPT: '/invite/accept',
        FORGOT_PASSWORD: '/forgot-password',
        RESET_PASSWORD: '/reset-password',
        CALLBACK: '/auth/callback',
        VERIFY_EMAIL: '/verify-email',
        VERIFY_EMAIL_CALLBACK: '/verify-email-callback',
    },
    ROOT: '/',
} as const;
