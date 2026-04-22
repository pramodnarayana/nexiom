import { useState, useMemo } from 'react';
import { Plug2, MoreVertical, RefreshCw, Trash2, Loader2, Settings } from 'lucide-react';
import { Button } from '@/shared/components/ui/button';
import { Badge } from '@/shared/components/ui/badge';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/shared/components/ui/dropdown-menu';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@/shared/components/ui/dialog';
import { type ProviderResponse, type ActiveConnectionResponse, type VendorParams, getConnectionCredentials } from '../api/connections.api';
import { DynamicAuthForm } from './DynamicAuthForm';
import { useConnections } from '../hooks/useConnections';
import { useToast } from '@/shared/hooks/use-toast';

interface ActiveConnectionCardProps {
    connection: ActiveConnectionResponse;
    provider?: ProviderResponse;
}

const STATUS_BADGE: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
    ACTIVE: { label: 'Active', variant: 'default' },
    INACTIVE: { label: 'Inactive', variant: 'secondary' },
    EXPIRED: { label: 'Expired', variant: 'destructive' },
    REVOKED: { label: 'Revoked', variant: 'destructive' },
};

export function ActiveConnectionCard({ connection, provider }: Readonly<ActiveConnectionCardProps>) {
    const statusInfo = STATUS_BADGE[connection.status] || { label: connection.status, variant: 'outline' };
    const { connect } = useConnections();
    const { toast } = useToast();

    const [imgError, setImgError] = useState(false);
    const [reconnecting, setReconnecting] = useState(false);
    const [manageOpen, setManageOpen] = useState(false);
    const [loadingManage, setLoadingManage] = useState(false);
    const [manageCreds, setManageCreds] = useState<{ clientId: string; hasClientSecret: boolean; vendorParams?: VendorParams } | null>(null);

    let callbackUrl = '';
    if (globalThis.window !== undefined) {
        const apiUrl = import.meta.env.VITE_API_URL || `${globalThis.window.location.origin}/api`;
        callbackUrl = `${apiUrl}/connect/callback`;
    }

    const handleOpenManage = async () => {
        if (!provider) return;

        if (connection.authType !== 'OAUTH2' || provider.authType !== 'OAUTH2') {
            toast({
                title: 'Operation unavailable',
                description: 'Managing non-OAuth connections is not currently supported.',
            });
            return;
        }

        try {
            setLoadingManage(true);
            const creds = await getConnectionCredentials(connection.id);
            setManageCreds(creds);
            setManageOpen(true);
        } catch (err: unknown) {
            console.error('Failed to open manage dialog:', err);
            toast({
                title: 'Operation failed',
                description: 'Failed to fetch existing connection credentials.',
                variant: 'destructive',
            });
        } finally {
            setLoadingManage(false);
        }
    };

    const manageDefaultValues = useMemo(() => {
        const extras = manageCreds?.vendorParams ? { ...manageCreds.vendorParams } : {};
        return {
            connectionName: connection.displayName,
            clientId: manageCreds?.clientId ?? '',
            // clientSecret intentionally left blank — never round-trip the stored secret.
            // The user must explicitly enter a new one if they want to rotate it.
            clientSecret: '',
            ...extras,
        };
    }, [connection.displayName, manageCreds?.clientId, manageCreds?.vendorParams]);

    const handleDynamicManage = async (data: {
        connectionName: string;
        clientId: string;
        clientSecret: string;
        vendorParams: VendorParams;
    }) => {
        if (!provider) return;
        if (connection.authType !== 'OAUTH2' || provider.authType !== 'OAUTH2') {
            return;
        }

        // Only forward a new clientSecret if the user explicitly typed one.
        // An empty string means "keep the server-side secret as-is".
        const secretToSend = data.clientSecret.trim().length > 0 ? data.clientSecret : undefined;
        await connect({
            providerName: provider.name,
            clientId: data.clientId,
            ...(secretToSend !== undefined && { clientSecret: secretToSend }),
            displayName: data.connectionName,
            vendorParams: data.vendorParams,
            id: connection.id,
        });
        setManageOpen(false);
    };

    const handleReconnect = async () => {
        if (!provider) return;
        if (connection.authType !== 'OAUTH2' || provider.authType !== 'OAUTH2') {
            toast({
                title: 'Operation unavailable',
                description: 'Reconnecting non-OAuth connections is not currently supported.',
            });
            return;
        }

        try {
            setReconnecting(true);
            const creds = await getConnectionCredentials(connection.id);
            // Do NOT pass down the stored clientSecret — the server will use
            // the persisted secret it holds. We only pass the clientId so the
            // OAuth popup knows which app to authenticate against.
            await connect({
                providerName: provider.name,
                clientId: creds.clientId,
                vendorParams: creds.vendorParams,
                displayName: connection.displayName,
                id: connection.id,
            });
        } catch (err: unknown) {
            console.error('Failed to reconnect:', err);
            toast({
                title: 'Reconnect failed',
                description: 'Could not reconnect to this provider. Please try again.',
                variant: 'destructive',
            });
        } finally {
            setReconnecting(false);
        }
    };

    const webhookUrl = useMemo(() => {
        if (typeof window === 'undefined') return '';
        // Use explicit webhook base URL if provided, otherwise derive from VITE_API_URL
        const webhookBase = import.meta.env.VITE_WEBHOOK_BASE_URL ||
                           (import.meta.env.VITE_API_URL ?
                            import.meta.env.VITE_API_URL.replace(/\/api\/?$/, '') :
                            window.location.origin);
        return `${webhookBase}/webhooks/${connection.id}`;
    }, [connection.id]);

    return (
        <div className="group relative flex flex-col items-center gap-3 rounded-2xl border border-border bg-card p-6 text-center shadow-sm transition-all duration-200 hover:shadow-md hover:border-primary/30 hover:-translate-y-0.5">
            {/* Context Menu — top-right corner */}
            <div className="absolute top-3 right-3 flex items-center gap-2">
                <Badge
                    variant="outline"
                    className={`text-[10px] px-1.5 py-0 ${connection.envType === 'SANDBOX' ? 'border-amber-400 text-amber-600' : 'border-green-500 text-green-700'}`}
                >
                    {connection.envType}
                </Badge>
                <Badge variant={statusInfo.variant} className="text-[10px] px-1.5 py-0">
                    {statusInfo.label}
                </Badge>
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-6 w-6">
                            <MoreVertical className="h-4 w-4" />
                            <span className="sr-only">Manage connection</span>
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => void handleOpenManage()} disabled={loadingManage || reconnecting || !provider}>
                            {loadingManage ? (
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            ) : (
                                <Settings className="mr-2 h-4 w-4" />
                            )}
                            Manage
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => void handleReconnect()} disabled={reconnecting || loadingManage || !provider}>
                            {reconnecting ? (
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            ) : (
                                <RefreshCw className="mr-2 h-4 w-4" />
                            )}
                            Reconnect
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem className="text-destructive focus:bg-destructive focus:text-destructive-foreground">
                            <Trash2 className="mr-2 h-4 w-4" />
                            Delete
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>

            {/* Logo */}
            <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-white border border-border shadow-sm overflow-hidden mt-2">
                {(() => {
                    if (!provider?.logoUrl) return <Plug2 className="h-7 w-7 text-muted-foreground" />;
                    if (imgError) return <span className="text-2xl font-bold text-muted-foreground">{provider.displayName.charAt(0)}</span>;
                    return (
                        <img
                            src={provider.logoUrl}
                            alt={`${provider.displayName} logo`}
                            className="h-9 w-9 object-contain"
                            onError={() => setImgError(true)}
                        />
                    );
                })()}
            </div>



            {/* Name + category */}
            <div className="w-full pb-2">
                <p className="font-semibold text-sm text-foreground truncate px-4" title={connection.displayName}>{connection.displayName}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{provider?.displayName || connection.appName}</p>
                
                <div className="px-4 mt-3">
                    <Button
                        variant="secondary"
                        size="sm"
                        className="w-full text-[11px] h-7 bg-secondary/50 hover:bg-secondary border border-border/50 text-muted-foreground hover:text-foreground transition-all"
                        onClick={async (e) => {
                            e.stopPropagation();
                            if (!navigator.clipboard) {
                                toast({
                                    title: "Copy Failed",
                                    description: "Clipboard API is not available in this browser.",
                                    variant: "destructive"
                                });
                                return;
                            }
                            try {
                                await navigator.clipboard.writeText(webhookUrl);
                                toast({
                                    title: "Webhook Copied",
                                    description: "URL is ready to be pasted into the vendor platform."
                                });
                            } catch (err) {
                                console.error('Failed to copy webhook URL:', err);
                                toast({
                                    title: "Copy Failed",
                                    description: "Could not copy to clipboard. Please copy manually.",
                                    variant: "destructive"
                                });
                            }
                        }}
                    >
                        Copy Webhook URL
                    </Button>
                </div>
            </div>

            <Dialog open={manageOpen} onOpenChange={setManageOpen}>
                <DialogContent className="sm:max-w-[480px] w-full">
                    <DialogHeader>
                        <DialogTitle>Manage {provider?.displayName}</DialogTitle>
                        <DialogDescription>
                            Update your OAuth credentials or configuration.
                        </DialogDescription>
                    </DialogHeader>
                    {provider && manageCreds && (
                        <DynamicAuthForm
                            provider={provider}
                            callbackUrl={callbackUrl}
                            isUpdate={true}
                            defaultValues={manageDefaultValues}
                            onCancel={() => setManageOpen(false)}
                            onSubmit={handleDynamicManage}
                        />
                    )}
                </DialogContent>
            </Dialog>
        </div>
    );
}