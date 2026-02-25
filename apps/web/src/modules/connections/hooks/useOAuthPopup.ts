import { useCallback, useEffect, useRef } from 'react';

export type OAuthPopupMessage =
    | { status: 'success'; provider: string; code: string }
    | { status: 'error'; error: string };

export type OAuthPopupOptions = {
    /** Called when the popup postMessages a success result */
    onSuccess: (data: { provider: string; code: string }) => void;
    /** Called when the popup postMessages an error result */
    onError: (error: string) => void;
};

/**
 * useOAuthPopup — opens a popup window for the OAuth flow and listens for
 * the postMessage result from the self-closing callback page.
 *
 * Architecture: docs/architecture/popup_oauth_strategy.md
 */
export function useOAuthPopup({ onSuccess, onError }: OAuthPopupOptions) {
    const popupRef = useRef<Window | null>(null);
    const onSuccessRef = useRef(onSuccess);
    const onErrorRef = useRef(onError);

    useEffect(() => {
        onSuccessRef.current = onSuccess;
        onErrorRef.current = onError;
    }, [onSuccess, onError]);

    // Stable message handler attached once via useEffect
    useEffect(() => {
        function handleMessage(event: MessageEvent) {
            // Security: verify origin against our API URL
            const expectedOrigin = import.meta.env.VITE_API_URL
                ? new URL(import.meta.env.VITE_API_URL, globalThis.location.origin).origin
                : globalThis.location.origin;

            if (event.origin !== expectedOrigin) return;

            const data = event.data as OAuthPopupMessage;
            if (typeof data !== 'object' || !data || !('status' in data)) return;

            if (data.status === 'success') {
                onSuccessRef.current({ provider: data.provider, code: data.code });
            } else if (data.status === 'error') {
                onErrorRef.current(data.error ?? 'unknown_error');
            }
        }
        window.addEventListener('message', handleMessage);
        return () => {
            window.removeEventListener('message', handleMessage);
            if (popupRef.current && !popupRef.current.closed) {
                popupRef.current.close();
            }
            popupRef.current = null;
        };
    }, []);

    const openPopup = useCallback((connectUrl: string) => {
        // Close stale popup if it's still open
        if (popupRef.current && !popupRef.current.closed) {
            popupRef.current.close();
        }

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
        }

    }, []);

    return { openPopup };
}
