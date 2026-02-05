import { describe, it, expect, vi, beforeEach } from 'vitest';
import { notificationProvider } from './notification-provider';
import * as useToast from '@/shared/hooks/use-toast';

vi.mock('@/shared/hooks/use-toast', () => ({
    toast: vi.fn(),
}));

describe('notificationProvider', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('open', () => {
        it('should call toast with success variant', () => {
            const mockDismiss = vi.fn();
            vi.mocked(useToast.toast).mockReturnValue({ dismiss: mockDismiss, id: 'test', update: vi.fn(), });

            notificationProvider.open({
                message: 'Success!',
                description: 'Operation completed',
                type: 'success',
            });

            expect(useToast.toast).toHaveBeenCalledWith({
                title: 'Success!',
                description: 'Operation completed',
                variant: 'success',
            });
        });

        it('should call toast with destructive variant for errors', () => {
            const mockDismiss = vi.fn();
            vi.mocked(useToast.toast).mockReturnValue({ dismiss: mockDismiss, id: 'test', update: vi.fn(), });

            notificationProvider.open({
                message: 'Error!',
                description: 'Something went wrong',
                type: 'error',
            });

            expect(useToast.toast).toHaveBeenCalledWith({
                title: 'Error!',
                description: 'Something went wrong',
                variant: 'destructive',
            });
        });

        it('should call toast with default variant for progress', () => {
            const mockDismiss = vi.fn();
            vi.mocked(useToast.toast).mockReturnValue({ dismiss: mockDismiss, id: 'test', update: vi.fn(), });

            notificationProvider.open({
                message: 'Loading...',
                type: 'progress',
            });

            expect(useToast.toast).toHaveBeenCalledWith({
                title: 'Loading...',
                description: undefined,
                variant: 'default',
            });
        });

        it('should store dismiss function when key is provided', () => {
            const mockDismiss = vi.fn();
            vi.mocked(useToast.toast).mockReturnValue({ dismiss: mockDismiss, id: 'test', update: vi.fn(), });

            notificationProvider.open({
                message: 'Test',
                type: 'success',
                key: 'test-key',
            });

            // Close should now be able to dismiss it
            notificationProvider.close('test-key');
            expect(mockDismiss).toHaveBeenCalled();
        });

        it('should not store dismiss function when key is not provided', () => {
            const mockDismiss = vi.fn();
            vi.mocked(useToast.toast).mockReturnValue({ dismiss: mockDismiss, id: 'test', update: vi.fn(), });

            notificationProvider.open({
                message: 'Test',
                type: 'success',
            });

            // Close with a random key should not call dismiss
            notificationProvider.close('random-key');
            expect(mockDismiss).not.toHaveBeenCalled();
        });
    });

    describe('close', () => {
        it('should dismiss toast when key exists', () => {
            const mockDismiss = vi.fn();
            vi.mocked(useToast.toast).mockReturnValue({ dismiss: mockDismiss, id: 'test', update: vi.fn(), });

            // Open with key
            notificationProvider.open({
                message: 'Test',
                type: 'success',
                key: 'test-key',
            });

            // Close it
            notificationProvider.close('test-key');

            expect(mockDismiss).toHaveBeenCalled();
        });

        it('should not throw error when key does not exist', () => {
            expect(() => {
                notificationProvider.close('non-existent-key');
            }).not.toThrow();
        });

        it('should remove dismiss function after closing', () => {
            const mockDismiss = vi.fn();
            vi.mocked(useToast.toast).mockReturnValue({ dismiss: mockDismiss, id: 'test', update: vi.fn(), });

            // Open and close
            notificationProvider.open({
                message: 'Test',
                type: 'success',
                key: 'test-key',
            });
            notificationProvider.close('test-key');

            // Try to close again - should not call dismiss again
            mockDismiss.mockClear();
            notificationProvider.close('test-key');
            expect(mockDismiss).not.toHaveBeenCalled();
        });
    });
});
