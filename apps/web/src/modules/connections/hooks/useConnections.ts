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
    const pendingCredentials = useRef<{ clientId: string; clientSecret?: string; env?: string } | null>(null);

    const refresh = useCallback(async () => {
        if (!user?.organizationId) return;
        setLoading(true);
        try {
            const data = await listActiveConnections(user.organizationId);
            setConnections(data);
        } finally {
            setLoading(false);
        }
    }, [user?.organizationId]);

    const handleSuccess = useCallback((data: { provider: string; code: string }) => {
        void (async () => {
            const { provider, code } = data;
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
                    clientId: pendingCredentials.current.clientId,
                    clientSecret: pendingCredentials.current.clientSecret,
                    tenantId: user.organizationId,
                    env: pendingCredentials.current.env,
                });
                toast({ title: `${provider} connected!`, description: 'Your connection is now active.' });
                void refresh();
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
        ({ providerName, clientId, clientSecret, env }: { providerName: string; clientId: string; clientSecret?: string; env?: string }) => {
            // Store credentials to use when the popup returns the code
            pendingCredentials.current = { clientId, clientSecret, env };

            const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';
            let popupUrl = `${apiUrl}/connectors/${providerName}?clientId=${encodeURIComponent(clientId)}&tenantId=${encodeURIComponent(user?.organizationId ?? '')}`;
            if (env) {
                popupUrl += `&env=${encodeURIComponent(env)}`;
            }
            // Initiate popup with BYOA credentials injected into the URL
            openPopup(popupUrl);
        },
        [openPopup, user?.organizationId],
    );

    return { connections, loading, refresh, connect };
}
