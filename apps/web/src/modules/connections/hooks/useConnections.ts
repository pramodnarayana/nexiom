import { useState, useCallback, useRef } from 'react';
import { useAuth } from '@/shared/lib/auth/context';
import { listActiveConnections, exchangeOAuthCode, createOAuthSession, type ActiveConnectionResponse } from '../api/connections.api';
import { useOAuthPopup } from './useOAuthPopup';
import { useToast } from '@/shared/hooks/use-toast';

/** Credentials collected from the DynamicAuthForm, held while the OAuth popup is open. */
type PendingCredential = {
    clientId: string;
    /** Optional — only include when the user explicitly provides or rotates the secret.
     *  When omitted, the backend uses the persisted secret it already holds. */
    clientSecret?: string;
    displayName: string;
    /** All vendor-specific parameters, including secrets — kept in memory only. */
    vendorParams?: Record<string, string | boolean | number>;
    /** Optional existing connection ID to explicitly overwrite */
    id?: string;
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
                    ...(pending.clientSecret ? { clientSecret: pending.clientSecret } : {}),
                    displayName: pending.displayName,
                    connectionId: pending.id,
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
        async ({ providerName, clientId, clientSecret, displayName, vendorParams, id }: { providerName: string } & PendingCredential): Promise<void> => {
            const apiUrl = import.meta.env.VITE_API_URL;
            if (!apiUrl) {
                toast({ title: 'Configuration Error', description: 'Missing VITE_API_URL environment variable.', variant: 'destructive' });
                throw new Error('Missing VITE_API_URL');
            }

            // Guard: block a second connect while a popup is already in progress.
            if (pendingCredentials.current) {
                toast({ title: 'Already connecting', description: 'Please complete or close the current connection popup first.', variant: 'destructive' });
                throw new Error('Already connecting');
            }

            try {
                // Reserve the slot immediately so concurrent calls are blocked
                pendingCredentials.current = { clientId, clientSecret, displayName, vendorParams, id };

                // Synchronously open a placeholder popup before awaiting to prevent popup-blockers
                // The openPopup hook/function now supports navigating an existing window.
                openPopup('');

                // Pre-flight session: securely persist all vendor parameters (including secrets/environments)
                // in the backend Redis cache and get an opaque short-lived sessionId back.
                const { sessionId } = await createOAuthSession({
                    providerName,
                    clientId,
                    vendorParams,
                });

                const popupUrl = `${apiUrl}/connectors/${providerName}?session=${sessionId}`;
                // Re-call openPopup with the actual URL to redirect the already-opened window
                openPopup(popupUrl);
            } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : 'Failed to establish secure OAuth pre-flight session';
                toast({ title: 'Connection Error', description: msg, variant: 'destructive' });
                pendingCredentials.current = null;
                throw err;
            }
        },
        [openPopup, toast],
    );

    return { connections, loading, refresh, connect };
}
