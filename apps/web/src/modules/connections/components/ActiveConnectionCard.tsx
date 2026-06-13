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
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
} from '@/shared/components/ui/sheet';
import { type ProviderResponse, type ActiveConnectionResponse, type VendorParams, getConnectionCredentials } from '../api/connections.api';
import { DynamicAuthForm } from './DynamicAuthForm';
import { useConnections } from '../hooks/useConnections';
import { useToast } from '@/shared/hooks/use-toast';

interface ActiveConnectionCardProps {
    connection: ActiveConnectionResponse;
    provider?: ProviderResponse;
    onDelete?: (dataSourceId: string) => void | Promise<void>;
}

const STATUS_BADGE: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
    ACTIVE: { label: 'Active', variant: 'default' },
    INACTIVE: { label: 'Inactive', variant: 'secondary' },
    EXPIRED: { label: 'Expired', variant: 'destructive' },
    REVOKED: { label: 'Revoked', variant: 'destructive' },
};

export function ActiveConnectionCard({ connection, provider, onDelete }: Readonly<ActiveConnectionCardProps>) {
    const statusInfo = STATUS_BADGE[connection.status] || { label: connection.status, variant: 'outline' };
    const { connect, remove } = useConnections();
    const { toast } = useToast();

    const [imgError, setImgError] = useState(false);
    const [reconnecting, setReconnecting] = useState(false);
    const [deleting, setDeleting] = useState(false);
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
        
        // If the backend provided a fully qualified absolute URL, use it directly
        if (connection.webhookUrl && connection.webhookUrl.startsWith('http')) {
            return connection.webhookUrl;
        }

        // Determine the base URL (VITE_API_URL, or fallback to window.location.origin)
        let base = import.meta.env.VITE_API_URL || window.location.origin;
        base = base.replace(/\/+$/, ''); // Remove trailing slashes
        
        // If backend provided a relative path, append it to the base
        if (connection.webhookUrl && connection.webhookUrl.startsWith('/')) {
            return `${base}${connection.webhookUrl}`;
        }
        
        // Fallback default format
        return `${base}/v1/webhooks/${connection.id}`;
    }, [connection.id, connection.webhookUrl]);

    const [detailsOpen, setDetailsOpen] = useState(false);

    return (
        <>
            <div
                className="group relative flex flex-col items-center gap-3 rounded-2xl border border-border bg-card p-6 text-center shadow-sm transition-all duration-200 hover:shadow-md hover:border-primary/30 hover:-translate-y-0.5 cursor-pointer"
                onClick={() => setDetailsOpen(prev => !prev)}
                onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        if (e.key === ' ') e.preventDefault();
                        setDetailsOpen(prev => !prev);
                    }
                }}
                tabIndex={0}
                role="button"
            >
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
                            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={(e) => e.stopPropagation()}>
                                <MoreVertical className="h-4 w-4" />
                                <span className="sr-only">Manage connection</span>
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
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
                            <DropdownMenuItem
                                className="text-destructive focus:bg-destructive focus:text-destructive-foreground"
                                disabled={deleting || reconnecting || loadingManage}
                                onClick={async () => {
                                    try {
                                        setDeleting(true);
                                        await remove(connection.id);
                                        if (onDelete) {
                                            await onDelete(connection.id);
                                        }
                                    } finally {
                                        setDeleting(false);
                                    }
                                }}
                            >
                                {deleting ? (
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                ) : (
                                    <Trash2 className="mr-2 h-4 w-4" />
                                )}
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
                </div>
            </div>

            <Dialog open={manageOpen} onOpenChange={setManageOpen}>
                <DialogContent className="sm:max-w-[480px] w-full" onClick={(e) => e.stopPropagation()}>
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

            {/* Separate Sheet for Connection Details */}
            <Sheet open={detailsOpen} onOpenChange={setDetailsOpen}>
                <SheetContent side="right" className="w-[400px] sm:w-[540px] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
                    <SheetHeader className="mb-6">
                        <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-border shadow-sm overflow-hidden bg-white shrink-0">
                                {(() => {
                                    if (!provider?.logoUrl) return <Plug2 className="h-5 w-5 text-muted-foreground" />;
                                    if (imgError) return <span className="text-lg font-bold text-muted-foreground">{provider.displayName.charAt(0)}</span>;
                                    return <img src={provider.logoUrl} alt="logo" className="h-6 w-6 object-contain" />;
                                })()}
                            </div>
                            <div>
                                <SheetTitle className="text-left text-lg">{connection.displayName}</SheetTitle>
                                <SheetDescription className="text-left">
                                    {provider?.displayName || connection.appName} Integration
                                </SheetDescription>
                            </div>
                        </div>
                    </SheetHeader>

                    <div className="flex flex-col gap-6">
                        {/* Status & Environment */}
                        <div className="flex items-center gap-4">
                            <div className="flex flex-col gap-1">
                                <span className="text-xs text-muted-foreground font-medium">Status</span>
                                <Badge variant={statusInfo.variant} className="w-fit">{statusInfo.label}</Badge>
                            </div>
                            <div className="flex flex-col gap-1">
                                <span className="text-xs text-muted-foreground font-medium">Environment</span>
                                <Badge variant="outline" className={`w-fit ${connection.envType === 'SANDBOX' ? 'border-amber-400 text-amber-600' : 'border-green-500 text-green-700'}`}>
                                    {connection.envType}
                                </Badge>
                            </div>
                            <div className="flex flex-col gap-1">
                                <span className="text-xs text-muted-foreground font-medium">Created</span>
                                <span className="text-sm">{new Date(connection.createdAt).toLocaleDateString()}</span>
                            </div>
                        </div>

                        <div className="w-full h-px bg-border/50" />

                        {/* Identifiers */}
                        <div className="flex flex-col gap-4">
                            <h3 className="font-semibold text-sm">Identifiers</h3>
                            
                            <div className="flex flex-col gap-1.5">
                                <span className="text-xs font-medium text-muted-foreground">Internal Connection ID</span>
                                <code className="text-xs bg-secondary/50 p-2 rounded-md break-all border border-border/50">
                                    {connection.id}
                                </code>
                            </div>

                            {connection.vendorTenantId && (
                                <div className="flex flex-col gap-1.5">
                                    <span className="text-xs font-medium text-muted-foreground">Vendor Tenant ID (Realm / Org ID)</span>
                                    <code className="text-xs bg-secondary/50 p-2 rounded-md break-all border border-border/50">
                                        {connection.vendorTenantId}
                                    </code>
                                </div>
                            )}
                        </div>

                        <div className="w-full h-px bg-border/50" />

                        {/* Webhooks */}
                        <div className="flex flex-col gap-4">
                            <h3 className="font-semibold text-sm">Webhooks</h3>
                            <p className="text-sm text-muted-foreground">
                                Use this URL to configure real-time event subscriptions in the vendor's developer console.
                            </p>
                            
                            <div className="flex flex-col gap-2">
                                <span className="text-xs font-medium text-muted-foreground">Target URL</span>
                                <div className="flex gap-2 items-start">
                                    <code className="flex-1 text-xs bg-secondary/50 p-2 rounded-md break-all border border-border/50">
                                        {webhookUrl}
                                    </code>
                                    <Button 
                                        variant="outline" 
                                        size="sm"
                                        className="shrink-0 h-[34px]"
                                        onClick={async () => {
                                            if (navigator.clipboard) {
                                                await navigator.clipboard.writeText(webhookUrl);
                                                toast({ title: "Webhook Copied!" });
                                            }
                                        }}
                                    >
                                        Copy
                                    </Button>
                                </div>
                            </div>
                        </div>
                    </div>
                </SheetContent>
            </Sheet>
        </>
    );
}