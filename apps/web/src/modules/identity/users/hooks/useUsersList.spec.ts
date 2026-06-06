import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useUsersList } from './useUsersList';
import * as refineCore from '@refinedev/core';
import * as authContext from '@/shared/lib/auth/context';
import * as useBasePathContext from '@/shared/contexts/useBasePath';
import * as authUtils from '@/shared/lib/auth/utils';

// Mock dependencies
vi.mock('@refinedev/core', () => ({
    useDelete: vi.fn(),
    useCustomMutation: vi.fn(),
}));

vi.mock('@/shared/lib/auth/context', () => ({
    useAuth: vi.fn(),
}));

vi.mock('@/shared/contexts/useBasePath', () => ({
    useBasePath: vi.fn(),
}));

vi.mock('@/shared/lib/auth/utils', () => ({
    hasPermission: vi.fn(),
    normalizeResource: vi.fn(),
}));

describe('useUsersList', () => {
    let mockDeleteUser: ReturnType<typeof vi.fn>;
    let mockSendInvite: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        vi.clearAllMocks();

        mockDeleteUser = vi.fn();
        mockSendInvite = vi.fn();

        vi.spyOn(refineCore, 'useDelete').mockReturnValue({ mutate: mockDeleteUser } as any);
        vi.spyOn(refineCore, 'useCustomMutation').mockReturnValue({ mutate: mockSendInvite } as any);
        
        vi.spyOn(useBasePathContext, 'useBasePath').mockReturnValue('/users');
        vi.spyOn(authUtils, 'normalizeResource').mockReturnValue('users');
        vi.spyOn(authUtils, 'hasPermission').mockReturnValue(true);
        
        vi.spyOn(authContext, 'useAuth').mockReturnValue({
            user: { id: 'user-1', name: 'Test User', permissions: [] },
        } as any);

        globalThis.confirm = vi.fn().mockReturnValue(true);
        import.meta.env.VITE_API_URL = 'http://test-api';
    });

    it('initializes with correct default state', () => {
        const { result } = renderHook(() => useUsersList());

        expect(result.current.basePath).toBe('/users');
        expect(result.current.normalizedResource).toBe('users');
        expect(result.current.canManageUsers).toBe(true);
        expect(result.current.invitingIds.size).toBe(0);
        expect(result.current.currentUser?.id).toBe('user-1');
    });

    it('respects resourceOverride', () => {
        vi.spyOn(authUtils, 'normalizeResource').mockReturnValue('custom-resource');
        
        const { result } = renderHook(() => useUsersList('/custom-resource/'));

        expect(authUtils.normalizeResource).toHaveBeenCalledWith('/custom-resource/');
        expect(result.current.normalizedResource).toBe('custom-resource');
    });

    describe('handleDelete', () => {
        it('calls deleteUser when confirmed', () => {
            const { result } = renderHook(() => useUsersList());

            act(() => {
                result.current.handleDelete('delete-id', 'Delete User');
            });

            expect(globalThis.confirm).toHaveBeenCalledWith(
                'Are you sure you want to delete Delete User? This action cannot be undone.'
            );
            expect(mockDeleteUser).toHaveBeenCalledWith(
                expect.objectContaining({
                    resource: 'users',
                    id: 'delete-id',
                    mutationMode: 'optimistic',
                })
            );

            // Verify error notification formatter
            const errorFormatter = mockDeleteUser.mock.calls[0][0].errorNotification;
            expect(errorFormatter({ message: 'Network error' })).toEqual({
                message: 'Failed to delete Delete User: Network error',
                type: 'error'
            });
        });

        it('does not call deleteUser when confirmation is cancelled', () => {
            globalThis.confirm = vi.fn().mockReturnValue(false);
            const { result } = renderHook(() => useUsersList());

            act(() => {
                result.current.handleDelete('delete-id', 'Delete User');
            });

            expect(mockDeleteUser).not.toHaveBeenCalled();
        });
    });

    describe('handleInvite', () => {
        it('sends invite and manages invitingIds state', () => {
            const { result } = renderHook(() => useUsersList());

            act(() => {
                result.current.handleInvite('invite-id', 'Invite User');
            });

            // State should immediately show as inviting
            expect(result.current.invitingIds.has('invite-id')).toBe(true);

            expect(mockSendInvite).toHaveBeenCalledWith(
                expect.objectContaining({
                    url: 'http://test-api/users/invite-id/invite',
                    method: 'post',
                    values: {},
                }),
                expect.any(Object) // onSettled options
            );

            // Verify error notification formatter
            const errorFormatter = mockSendInvite.mock.calls[0][0].errorNotification;
            expect(errorFormatter({ message: 'Bad request' })).toEqual({
                message: 'Failed to send invite: Bad request',
                type: 'error'
            });

            // Simulate onSettled callback to ensure state is cleaned up
            const onSettled = mockSendInvite.mock.calls[0][1].onSettled;
            act(() => {
                onSettled();
            });

            expect(result.current.invitingIds.has('invite-id')).toBe(false);
        });

        it('prevents multiple concurrent invites for the same id', () => {
            const { result } = renderHook(() => useUsersList());

            act(() => {
                result.current.handleInvite('invite-id', 'Invite User');
            });

            expect(mockSendInvite).toHaveBeenCalledTimes(1);

            // Call again while it's in invitingIds
            act(() => {
                result.current.handleInvite('invite-id', 'Invite User');
            });

            // Should not be called a second time
            expect(mockSendInvite).toHaveBeenCalledTimes(1);
        });
    });
});
