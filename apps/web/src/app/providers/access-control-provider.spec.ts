import { describe, it, expect, vi, beforeEach } from 'vitest';
import { accessControlProvider } from './access-control-provider';
import { authProvider } from './auth-provider';
import * as authUtils from '@/shared/lib/auth/utils';

vi.mock('./auth-provider', () => ({
    authProvider: {
        getPermissions: vi.fn() as () => Promise<string[] | null>,
    },
}));

vi.mock('@/shared/lib/auth/utils', () => ({
    hasPermission: vi.fn(),
}));

describe('accessControlProvider', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('can', () => {
        it('should grant access with wildcard permission', async () => {
            vi.mocked(authProvider.getPermissions!).mockResolvedValue(['*']);
            vi.mocked(authUtils.hasPermission).mockReturnValue(true);

            const result = await accessControlProvider.can({ resource: 'users', action: 'read' });

            expect(result).toEqual({ can: true });
            expect(authUtils.hasPermission).toHaveBeenCalledWith(['*'], 'users', 'read');
        });

        it('should grant access with exact permission', async () => {
            vi.mocked(authProvider.getPermissions!).mockResolvedValue(['users:read']);
            vi.mocked(authUtils.hasPermission).mockReturnValue(true);

            const result = await accessControlProvider.can({ resource: 'users', action: 'read' });

            expect(result).toEqual({ can: true });
        });

        it('should deny access without permission', async () => {
            vi.mocked(authProvider.getPermissions!).mockResolvedValue(['users:write']);
            vi.mocked(authUtils.hasPermission).mockReturnValue(false);

            const result = await accessControlProvider.can({ resource: 'users', action: 'read' });

            expect(result).toEqual({
                can: false,
                reason: 'Missing permission: users:read',
            });
        });

        it('should normalize admin/users to system_users', async () => {
            vi.mocked(authProvider.getPermissions!).mockResolvedValue(['system_users:read']);
            vi.mocked(authUtils.hasPermission).mockReturnValue(true);

            await accessControlProvider.can({ resource: 'admin/users', action: 'read' });

            expect(authUtils.hasPermission).toHaveBeenCalledWith(['system_users:read'], 'system_users', 'read');
        });

        it('should normalize admin/tenants to system_tenants', async () => {
            vi.mocked(authProvider.getPermissions!).mockResolvedValue(['system_tenants:read']);
            vi.mocked(authUtils.hasPermission).mockReturnValue(true);

            await accessControlProvider.can({ resource: 'admin/tenants', action: 'read' });

            expect(authUtils.hasPermission).toHaveBeenCalledWith(['system_tenants:read'], 'system_tenants', 'read');
        });

        it('should strip admin/ prefix for unmapped resources', async () => {
            vi.mocked(authProvider.getPermissions!).mockResolvedValue(['settings:read']);
            vi.mocked(authUtils.hasPermission).mockReturnValue(true);

            await accessControlProvider.can({ resource: 'admin/settings', action: 'read' });

            expect(authUtils.hasPermission).toHaveBeenCalledWith(['settings:read'], 'settings', 'read');
        });

        it('should normalize list action to read', async () => {
            vi.mocked(authProvider.getPermissions!).mockResolvedValue(['users:read']);
            vi.mocked(authUtils.hasPermission).mockReturnValue(true);

            await accessControlProvider.can({ resource: 'users', action: 'list' });

            expect(authUtils.hasPermission).toHaveBeenCalledWith(['users:read'], 'users', 'read');
        });

        it('should normalize show action to read', async () => {
            vi.mocked(authProvider.getPermissions!).mockResolvedValue(['users:read']);
            vi.mocked(authUtils.hasPermission).mockReturnValue(true);

            await accessControlProvider.can({ resource: 'users', action: 'show' });

            expect(authUtils.hasPermission).toHaveBeenCalledWith(['users:read'], 'users', 'read');
        });

        it('should normalize edit action to update', async () => {
            vi.mocked(authProvider.getPermissions!).mockResolvedValue(['users:update']);
            vi.mocked(authUtils.hasPermission).mockReturnValue(true);

            await accessControlProvider.can({ resource: 'users', action: 'edit' });

            expect(authUtils.hasPermission).toHaveBeenCalledWith(['users:update'], 'users', 'update');
        });

        it('should handle empty permissions array', async () => {
            vi.mocked(authProvider.getPermissions!).mockResolvedValue([]);
            vi.mocked(authUtils.hasPermission).mockReturnValue(false);

            const result = await accessControlProvider.can({ resource: 'users', action: 'read' });

            expect(result).toEqual({
                can: false,
                reason: 'Missing permission: users:read',
            });
        });

        it('should handle null getPermissions response', async () => {
            vi.mocked(authProvider.getPermissions!).mockResolvedValue(null as unknown as string[]);
            vi.mocked(authUtils.hasPermission).mockReturnValue(false);

            const result = await accessControlProvider.can({ resource: 'users', action: 'read' });

            expect(result.can).toBe(false);
            expect(authUtils.hasPermission).toHaveBeenCalledWith([], 'users', 'read');
        });

        it('should use manage as default action', async () => {
            vi.mocked(authProvider.getPermissions!).mockResolvedValue(['users:manage']);
            vi.mocked(authUtils.hasPermission).mockReturnValue(true);

            await accessControlProvider.can({ resource: 'users', action: undefined as unknown as string });

            expect(authUtils.hasPermission).toHaveBeenCalledWith(['users:manage'], 'users', 'manage');
        });
    });
});
