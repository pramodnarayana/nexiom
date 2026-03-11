import { useCallback, useEffect, useRef } from 'react';

export type OAuthPopupMessage =
    | { status: 'success'; provider: string; code: string; state: string; vendorParams?: Record<string, string> }
    | { status: 'error'; error: string };

export type OAuthPopupOptions = {
    /** Called when the popup postMessages a success result */
    onSuccess: (data: { provider: string; code: string; state: string; vendorParams?: Record<string, string> }) => void;
    /** Called when the popup postMessages an error result */
    onError: (error: string) => void;
    /** Called when the popup window is closed by the user without completing the flow */
    onClose?: () => void;
};

/**
 * useOAuthPopup — opens a popup window for the OAuth flow and listens for
 * the postMessage result from the self-closing callback page.
 *
 * Architecture: docs/architecture/popup_oauth_strategy.md
 */
export function useOAuthPopup({ onSuccess, onError, onClose }: OAuthPopupOptions) {
    const popupRef = useRef<Window | null>(null);
    const onSuccessRef = useRef(onSuccess);
    const onErrorRef = useRef(onError);
    const onCloseRef = useRef(onClose);
    // Track whether the flow completed via postMessage so onClose is
    // not called after a normal success/error path.
    const completedRef = useRef(false);
    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const stopPoll = useCallback(() => {
        if (pollRef.current !== null) {
            clearInterval(pollRef.current);
            pollRef.current = null;
        }
    }, []);

    useEffect(() => {
        onSuccessRef.current = onSuccess;
        onErrorRef.current = onError;
        onCloseRef.current = onClose;
    }, [onSuccess, onError, onClose]);

    // Stable message handler attached once via useEffect
    useEffect(() => {
        // Security: verify origin against our API URL
        const expectedOrigin = import.meta.env.VITE_API_URL
            ? new URL(import.meta.env.VITE_API_URL, globalThis.location.origin).origin
            : globalThis.location.origin;

        function handleMessage(event: MessageEvent) {
            if (event.origin !== expectedOrigin || event.source !== popupRef.current) return;

            const data = event.data as OAuthPopupMessage;
            if (typeof data !== 'object' || !data || !('status' in data)) return;

            if (data.status === 'success') {
                if (typeof data.provider === 'string' && typeof data.code === 'string' && typeof data.state === 'string') {
                    completedRef.current = true;
                    stopPoll();
                    onSuccessRef.current({ provider: data.provider, code: data.code, state: data.state, vendorParams: data.vendorParams });
                } else {
                    completedRef.current = true;
                    stopPoll();
                    onErrorRef.current('invalid_payload');
                }
            } else if (data.status === 'error') {
                completedRef.current = true;
                stopPoll();
                onErrorRef.current(typeof data.error === 'string' ? data.error : 'unknown_error');
            } else {
                completedRef.current = true;
                stopPoll();
                onErrorRef.current('invalid_payload');
            }
        }
        window.addEventListener('message', handleMessage);
        return () => {
            window.removeEventListener('message', handleMessage);
            stopPoll();
            if (popupRef.current && !popupRef.current.closed) {
                popupRef.current.close();
            }
            popupRef.current = null;
        };
    }, [stopPoll]);

    const openPopup = useCallback((connectUrl: string) => {
        // If an existing popup is open...
        if (popupRef.current && !popupRef.current.closed) {
            // ...navigate it to the new URL if provided, otherwise just focus it
            if (connectUrl) {
                popupRef.current.location.href = connectUrl;
            } else {
                popupRef.current.focus();
            }
            return;
        }

        // Cancel any in-flight poll since we are opening a fresh window
        stopPoll();
        completedRef.current = false;

        const width = 600;
        const height = 800;
        const left = window.screenX + (window.outerWidth - width) / 2;
        const top = window.screenY + (window.outerHeight - height) / 2;

        popupRef.current = window.open(
            connectUrl,
            'nexiom_oauth',
            `width=${width},height=${height},left=${left},top=${top},resizable=no`,
        );
        if (!popupRef.current) {
            onErrorRef.current('popup_blocked');
            return;
        }

        // Poll every 500 ms to detect manual close (no postMessage fired)
        pollRef.current = setInterval(() => {
            if (popupRef.current?.closed) {
                stopPoll();
                if (!completedRef.current) {
                    onCloseRef.current?.();
                }
                popupRef.current = null;
            }
        }, 500);
    }, [stopPoll]);

    return { openPopup };
}
