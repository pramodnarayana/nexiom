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
                onSuccess({ provider: data.provider, code: data.code });
            } else if (data.status === 'error') {
                onError(data.error ?? 'unknown_error');
            }
        }

        globalThis.addEventListener('message', handleMessage);
        return () => globalThis.removeEventListener('message', handleMessage);
    }, [onSuccess, onError]);

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
    }, []);

    return { openPopup };
}
