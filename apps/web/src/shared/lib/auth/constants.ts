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
        PROFILE: '/settings/profile',
    },
    AUTH: {
        LOGIN: '/login',
        SIGNUP: '/signup',
        INVITE_ACCEPT: '/invite/accept',
        FORGOT_PASSWORD: '/forgot-password',
        RESET_PASSWORD: '/reset-password',
        CALLBACK: '/auth/callback',
    },
    ROOT: '/',
} as const;
