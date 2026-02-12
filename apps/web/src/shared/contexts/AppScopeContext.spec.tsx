import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { type ReactNode } from 'react';
import { AppScopeProvider } from './AppScopeContext';
import {
    useAppScope,
    useResourceName,
    useIsSystemScope,
    type AppScope
} from './useAppScope';
import { RESOURCES } from '../constants/resources';

describe('AppScopeContext', () => {
    const createWrapper = (scope: AppScope) => {
        return ({ children }: { children: ReactNode }) => (
            <AppScopeProvider scope={scope}>
                {children}
            </AppScopeProvider>
        );
    };

    describe('useAppScope', () => {
        it('provides system scope and resources', () => {
            const { result } = renderHook(() => useAppScope(), {
                wrapper: createWrapper('system'),
            });

            expect(result.current.scope).toBe('system');
            expect(result.current.resources).toEqual(RESOURCES.SYSTEM);
        });

        it('provides organization scope and resources', () => {
            const { result } = renderHook(() => useAppScope(), {
                wrapper: createWrapper('organization'),
            });

            expect(result.current.scope).toBe('organization');
            expect(result.current.resources).toEqual(RESOURCES.ORGANIZATION);
        });

        it('throws error when used outside provider', () => {
            expect(() => {
                renderHook(() => useAppScope());
            }).toThrow('useAppScope must be used within AppScopeProvider');
        });
    });

    describe('useResourceName', () => {
        it('returns system resource names for system scope', () => {
            const { result } = renderHook(() => useResourceName('INVITATIONS'), {
                wrapper: createWrapper('system'),
            });

            expect(result.current).toBe('admin/invitations');
        });

        it('returns organization resource names for organization scope', () => {
            const { result } = renderHook(() => useResourceName('INVITATIONS'), {
                wrapper: createWrapper('organization'),
            });

            expect(result.current).toBe('invitations');
        });

        it('works for all resource types', () => {
            const wrapper = createWrapper('system');

            const { result: users } = renderHook(() => useResourceName('USERS'), { wrapper });
            const { result: invitations } = renderHook(() => useResourceName('INVITATIONS'), { wrapper });
            const { result: tenants } = renderHook(() => useResourceName('TENANTS'), { wrapper });

            expect(users.current).toBe('admin/users');
            expect(invitations.current).toBe('admin/invitations');
            expect(tenants.current).toBe('admin/tenants');
        });
    });

    describe('useIsSystemScope', () => {
        it('returns true for system scope', () => {
            const { result } = renderHook(() => useIsSystemScope(), {
                wrapper: createWrapper('system'),
            });

            expect(result.current).toBe(true);
        });

        it('returns false for organization scope', () => {
            const { result } = renderHook(() => useIsSystemScope(), {
                wrapper: createWrapper('organization'),
            });

            expect(result.current).toBe(false);
        });
    });
});
