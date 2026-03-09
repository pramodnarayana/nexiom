import { useState, useCallback, useRef } from 'react';
import { useAuth } from '@/shared/lib/auth/context';
import { listActiveConnections, exchangeOAuthCode, type ActiveConnectionResponse } from '../api/connections.api';
import { useOAuthPopup } from './useOAuthPopup';
import { useToast } from '@/shared/hooks/use-toast';

/** Credentials collected from the DynamicAuthForm, held while the OAuth popup is open. */
type PendingCredential = {
    clientId: string;
    /** Always required — /oauth-exchange always expects a non-empty secret. */
    clientSecret: string;
    displayName: string;
    /** All vendor-specific parameters, including secrets — kept in memory only. */
    vendorParams?: Record<string, string | boolean | number>;
    /** Only the non-secret subset of vendorParams — safe to encode in the popup URL. */
    safeVendorParams?: Record<string, string | boolean | number>;
};

export function useConnections() {
    const { user } = useAuth();
    const { toast } = useToast();
    const [connections, setConnections] = useState<ActiveConnectionResponse[]>([]);
    const [loading, setLoading] = useState(false);

    // Store credentials temporarily while the popup is open.
    // The popup is inherently single-session (openPopup closes any stale window),
    // so a single ref is safe here. connect() is guarded to reject concurrent calls.
    const pendingCredentials = useRef<PendingCredential | null>(null);

    const refresh = useCallback(async () => {
        if (!user?.organizationId) return;
        setLoading(true);
        try {
            const data = await listActiveConnections();
            setConnections(data);
        } catch (err: unknown) {
            console.error('[useConnections] Failed to refresh connections', err);
            toast({ title: 'Error', description: 'Failed to refresh connections.', variant: 'destructive' });
        } finally {
            setLoading(false);
        }
    }, [user?.organizationId, toast]);

    const handleSuccess = useCallback((data: { provider: string; code: string; state: string; vendorParams?: Record<string, string | boolean | number> }) => {
        void (async () => {
            const { provider, code, state, vendorParams } = data;
            if (!pendingCredentials.current) {
                console.error('[useConnections] handleSuccess fired but pendingCredentials is null — possible stale event');
                toast({ title: 'Error', description: 'Missing pending credentials for exchange.', variant: 'destructive' });
                return;
            }

            const pending = pendingCredentials.current;
            // Clear immediately so any concurrent invocation cannot reuse stale data.
            pendingCredentials.current = null;

            toast({ title: 'Connecting...', description: `Exchanging code with ${provider}...` });

            try {
                if (!user?.organizationId) {
                    toast({ title: 'Error', description: 'No organization context available.', variant: 'destructive' });
                    return;
                }
                await exchangeOAuthCode({
                    providerName: provider,
                    code,
                    state,
                    vendorParams: {
                        ...(pending.vendorParams),
                        ...(vendorParams),
                    },
                    clientId: pending.clientId,
                    clientSecret: pending.clientSecret,
                    displayName: pending.displayName,
                });
                toast({ title: `${provider} connected!`, description: 'Your connection is now active.' });
                await refresh();
            } catch (err: unknown) {
                let msg = 'Unknown error occurred.';
                if (err instanceof Error) {
                    msg = err.message;
                } else if (typeof err === 'object' && err !== null && 'response' in err) {
                    const anyErr = err as { response?: { data?: { message?: string } } };
                    if (anyErr.response?.data?.message) {
                        msg = anyErr.response.data.message;
                    }
                }
                toast({ title: 'Connection Setup Failed', description: msg, variant: 'destructive' });
            }
        })();
    }, [user?.organizationId, toast, refresh]);

    const handleError = useCallback((error: string) => {
        pendingCredentials.current = null;
        toast({
            title: 'Connection failed',
            description: error.replaceAll('_', ' '),
            variant: 'destructive',
        });
    }, [toast]);

    const handleClose = useCallback(() => {
        // User dismissed the popup without completing the flow — release the guard.
        pendingCredentials.current = null;
    }, []);

    const { openPopup } = useOAuthPopup({
        onSuccess: handleSuccess,
        onError: handleError,
        onClose: handleClose,
    });

    const connect = useCallback(
        ({ providerName, clientId, clientSecret, displayName, vendorParams, safeVendorParams }: { providerName: string } & PendingCredential) => {
            const apiUrl = import.meta.env.VITE_API_URL;
            if (!apiUrl) {
                toast({ title: 'Configuration Error', description: 'Missing VITE_API_URL environment variable.', variant: 'destructive' });
                return;
            }

            // Guard: block a second connect while a popup is already in progress.
            if (pendingCredentials.current) {
                toast({ title: 'Already connecting', description: 'Please complete or close the current connection popup first.', variant: 'destructive' });
                return;
            }

            pendingCredentials.current = { clientId, clientSecret, displayName, vendorParams, safeVendorParams };

            // Build popup URL.
            // Only the explicit safeVendorParams (non-SECRET_TEXT fields derived from the uiSchema)
            // are appended to the URL so they can be embedded in the signed OAuth state.
            // SECRET_TEXT vendorParams are held in pendingCredentials and merged in handleSuccess.
            let popupUrl = `${apiUrl}/connectors/${providerName}?clientId=${encodeURIComponent(clientId)}`;
            if (safeVendorParams && Object.keys(safeVendorParams).length > 0) {
                popupUrl += `&vendorParams=${encodeURIComponent(JSON.stringify(safeVendorParams))}`;
            }
            openPopup(popupUrl);
        },
        [openPopup, toast],
    );

    return { connections, loading, refresh, connect };
}
