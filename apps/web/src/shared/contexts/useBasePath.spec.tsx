import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { type ReactNode } from 'react';
import { AppScopeProvider } from './AppScopeContext';
import { useBasePath } from './useBasePath';
import { type AppScope } from './useAppScope';

describe('useBasePath', () => {
    const createWrapper = (scope: AppScope) => {
        return ({ children }: { children: ReactNode }) => (
            <AppScopeProvider scope={scope}>
                {children}
            </AppScopeProvider>
        );
    };

    describe('system scope', () => {
        it('returns /admin/users for USERS resource', () => {
            const { result } = renderHook(() => useBasePath('USERS'), {
                wrapper: createWrapper('system'),
            });

            expect(result.current).toBe('/admin/users');
        });

        it('returns /admin/invitations for INVITATIONS resource', () => {
            const { result } = renderHook(() => useBasePath('INVITATIONS'), {
                wrapper: createWrapper('system'),
            });

            expect(result.current).toBe('/admin/invitations');
        });

        it('returns /admin/tenants for TENANTS resource', () => {
            const { result } = renderHook(() => useBasePath('TENANTS'), {
                wrapper: createWrapper('system'),
            });

            expect(result.current).toBe('/admin/tenants');
        });
    });

    describe('organization scope', () => {
        it('returns /dashboard/users for USERS resource', () => {
            const { result } = renderHook(() => useBasePath('USERS'), {
                wrapper: createWrapper('organization'),
            });

            expect(result.current).toBe('/dashboard/users');
        });

        it('returns /dashboard/invitations for INVITATIONS resource', () => {
            const { result } = renderHook(() => useBasePath('INVITATIONS'), {
                wrapper: createWrapper('organization'),
            });

            expect(result.current).toBe('/dashboard/invitations');
        });

        it('returns /dashboard/tenants for TENANTS resource', () => {
            const { result } = renderHook(() => useBasePath('TENANTS'), {
                wrapper: createWrapper('organization'),
            });

            expect(result.current).toBe('/dashboard/tenants');
        });
    });

    describe('path consistency', () => {
        it('returns different paths for different scopes', () => {
            const { result: systemResult } = renderHook(() => useBasePath('USERS'), {
                wrapper: createWrapper('system'),
            });

            const { result: orgResult } = renderHook(() => useBasePath('USERS'), {
                wrapper: createWrapper('organization'),
            });

            expect(systemResult.current).toBe('/admin/users');
            expect(orgResult.current).toBe('/dashboard/users');
        });

        it('always includes leading slash', () => {
            const systemWrapper = createWrapper('system');
            const orgWrapper = createWrapper('organization');

            const { result: systemUsers } = renderHook(() => useBasePath('USERS'), { wrapper: systemWrapper });
            const { result: systemInvites } = renderHook(() => useBasePath('INVITATIONS'), { wrapper: systemWrapper });
            const { result: systemTenants } = renderHook(() => useBasePath('TENANTS'), { wrapper: systemWrapper });
            const { result: orgUsers } = renderHook(() => useBasePath('USERS'), { wrapper: orgWrapper });
            const { result: orgInvites } = renderHook(() => useBasePath('INVITATIONS'), { wrapper: orgWrapper });
            const { result: orgTenants } = renderHook(() => useBasePath('TENANTS'), { wrapper: orgWrapper });

            expect(systemUsers.current.startsWith('/')).toBe(true);
            expect(systemInvites.current.startsWith('/')).toBe(true);
            expect(systemTenants.current.startsWith('/')).toBe(true);
            expect(orgUsers.current.startsWith('/')).toBe(true);
            expect(orgInvites.current.startsWith('/')).toBe(true);
            expect(orgTenants.current.startsWith('/')).toBe(true);
        });
    });

    describe('error handling', () => {
        it('throws error when used outside AppScopeProvider', () => {
            expect(() => {
                renderHook(() => useBasePath('USERS'));
            }).toThrow('useAppScope must be used within AppScopeProvider');
        });
    });
});
