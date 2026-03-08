import { useState, useCallback, useRef } from 'react';
import { useAuth } from '@/shared/lib/auth/context';
import { listActiveConnections, exchangeOAuthCode, type ActiveConnectionResponse } from '../api/connections.api';
import { useOAuthPopup } from './useOAuthPopup';
import { useToast } from '@/shared/hooks/use-toast';

export function useConnections() {
    const { user } = useAuth();
    const { toast } = useToast();
    const [connections, setConnections] = useState<ActiveConnectionResponse[]>([]);
    const [loading, setLoading] = useState(false);

    // Store credentials temporarily while the popup is open
    const pendingCredentials = useRef<{ clientId: string; clientSecret?: string; displayName: string; env?: string; vendorParams?: Record<string, string> } | null>(null);

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

    const handleSuccess = useCallback((data: { provider: string; code: string; state: string; vendorParams?: Record<string, string> }) => {
        void (async () => {
            const { provider, code, state, vendorParams } = data;
            if (!pendingCredentials.current) {
                toast({ title: 'Error', description: 'Missing pending credentials for exchange.', variant: 'destructive' });
                return;
            }

            toast({ title: 'Connecting...', description: `Exchanging code with ${provider}...` });

            try {
                if (!user?.organizationId) {
                    toast({ title: 'Error', description: 'No organization context available.', variant: 'destructive' });
                    pendingCredentials.current = null;
                    return;
                }
                await exchangeOAuthCode({
                    providerName: provider,
                    code,
                    state,
                    // Merge vendorParams from the popup response with those stored
                    // in pendingCredentials (user-entered SECRET_TEXT fields).
                    // Popup params take precedence for fields that appear in both.
                    vendorParams: {
                        ...(pendingCredentials.current.vendorParams),
                        ...(vendorParams),
                    },
                    clientId: pendingCredentials.current.clientId,
                    clientSecret: pendingCredentials.current.clientSecret,
                    displayName: pendingCredentials.current.displayName,
                    env: pendingCredentials.current.env,
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
            } finally {
                pendingCredentials.current = null;
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

    const { openPopup } = useOAuthPopup({
        onSuccess: handleSuccess,
        onError: handleError,
    });

    const connect = useCallback(
        ({ providerName, clientId, clientSecret, displayName, env, vendorParams }: { providerName: string; clientId: string; clientSecret?: string; displayName: string; env?: string; vendorParams?: Record<string, string> }) => {
            const apiUrl = import.meta.env.VITE_API_URL;
            if (!apiUrl) {
                toast({ title: 'Configuration Error', description: 'Missing VITE_API_URL environment variable.', variant: 'destructive' });
                pendingCredentials.current = null;
                return;
            }

            pendingCredentials.current = { clientId, clientSecret, displayName, env, vendorParams };

            // Build popup URL — do NOT include vendorParams here to avoid leaking
            // SECRET_TEXT values into GET URLs, server logs, or browser history.
            // vendorParams are merged server-side from pendingCredentials in handleSuccess.
            let popupUrl = `${apiUrl}/connectors/${providerName}?clientId=${encodeURIComponent(clientId)}`;
            if (env) {
                popupUrl += `&env=${encodeURIComponent(env)}`;
            }
            // Initiate popup with BYOA credentials injected into the URL
            openPopup(popupUrl);
        },
        [openPopup, toast],
    );

    return { connections, loading, refresh, connect };
}
