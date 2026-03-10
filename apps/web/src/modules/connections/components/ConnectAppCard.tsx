import { useState, useMemo } from 'react';
import { Plug2 } from 'lucide-react';
import { Button } from '@/shared/components/ui/button';
import { Badge } from '@/shared/components/ui/badge';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from '@/shared/components/ui/dialog';
import { type ProviderResponse, type ActiveConnectionResponse, type VendorParams, getConnectionCredentials } from '../api/connections.api';
import { DynamicAuthForm } from './DynamicAuthForm';

interface ConnectAppCardProps {
    provider: ProviderResponse;
    connection?: ActiveConnectionResponse;
    onConnect: (args: { providerName: string; clientId: string; clientSecret: string; displayName: string; vendorParams?: VendorParams }) => Promise<void>;
}

const STATUS_BADGE: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
    ACTIVE: { label: 'Active', variant: 'default' },
    INACTIVE: { label: 'Inactive', variant: 'secondary' },
    EXPIRED: { label: 'Expired', variant: 'destructive' },
    REVOKED: { label: 'Revoked', variant: 'destructive' },
};

function coerceVendorParams(
    vendorParams: VendorParams | undefined,
    uiSchema: Record<string, unknown> | undefined
): VendorParams {
    if (!vendorParams) return {};

    const coerced: VendorParams = {};
    for (const [key, value] of Object.entries(vendorParams)) {
        const schemaDef = uiSchema?.[key] as { type?: string } | undefined;
        const type = schemaDef?.type;

        if (type === 'CHECKBOX') {
            coerced[key] = value === 'true' || value === true || value === '1' || value === 1;
        } else if (type === 'NUMBER') {
            if (value === '' || value === null || value === undefined) {
                // skip — do not set empty values for NUMBER fields to respect VendorParams typing
            } else {
                const num = Number(value);
                coerced[key] = Number.isNaN(num) ? value : num;
            }
        } else {
            coerced[key] = value;
        }
    }
    return coerced;
}

/**
 * ConnectAppCard — Activepieces-style provider card.
 *
 * Keeps it visual and minimal: large logo, display name, category badge, and
 * a single action button. Status badge shows when already connected.
 */
export function ConnectAppCard({ provider, connection, onConnect }: Readonly<ConnectAppCardProps>) {
    const statusInfo = connection ? STATUS_BADGE[connection.status] : null;
    const isConnected = connection?.status === 'ACTIVE';

    const [open, setOpen] = useState(false);
    const [imgError, setImgError] = useState(false);
    const [defaultCreds, setDefaultCreds] = useState<{ clientId: string; clientSecret?: string; vendorParams?: Record<string, string | boolean | number> } | undefined>();

    const handleOpenChange = (isOpen: boolean) => {
        setOpen(isOpen);
        if (isOpen && connection) {
            if (connection.hasCredentials) {
                getConnectionCredentials(connection.id)
                    .then((creds) => {
                        setDefaultCreds({ clientId: creds.clientId, clientSecret: creds.clientSecret, vendorParams: creds.vendorParams });
                    })
                    .catch((err) => {
                        console.error(`[ConnectAppCard] Failed to fetch credentials for connection ${connection.id} (${connection.displayName}):`, err);
                    });
            }
        }
        if (!isOpen) {
            setDefaultCreds(undefined);
        }
    };

    // Compute the callback URL dynamically based on the current window origin.
    // Assuming backend API is on /api or a predictable subdomain.
    // For local dev where frontend is 5173 and backend is 3000, we might need a fallback,
    // but in prod they usually share the domain. We'll use a generic /api prefix
    // which assumes the Vite proxy or ingress controller handles it.
    let callbackUrl = '';
    if (globalThis.window !== undefined) {
        const apiUrl = import.meta.env.VITE_API_URL || `${globalThis.window.location.origin}/api`;
        callbackUrl = `${apiUrl}/connect/callback`;
    }

    const handleDynamicConnect = async (data: {
        connectionName: string;
        clientId: string;
        clientSecret: string;
        vendorParams: VendorParams;
    }) => {
        await onConnect({
            providerName: provider.name,
            clientId: data.clientId,
            clientSecret: data.clientSecret,
            displayName: data.connectionName,
            vendorParams: data.vendorParams,
        });
        handleOpenChange(false);
    };

    return (
        <div
            id={`connect-card-${provider.name}`}
            className="group relative flex flex-col items-center gap-3 rounded-2xl border border-border bg-card p-6 text-center shadow-sm transition-all duration-200 hover:shadow-md hover:border-primary/30 hover:-translate-y-0.5"
        >
            {/* Status badge — top-right corner */}
            {statusInfo && (
                <div className="absolute top-3 right-3">
                    <Badge variant={statusInfo.variant} className="text-[10px] px-1.5 py-0">
                        {statusInfo.label}
                    </Badge>
                </div>
            )}

            {/* Logo */}
            <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-white border border-border shadow-sm overflow-hidden">
                {(() => {
                    if (!provider.logoUrl) return <Plug2 className="h-7 w-7 text-muted-foreground" />;
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
            <div>
                <p className="font-semibold text-sm text-foreground">{provider.displayName}</p>
                {provider.category && (
                    <p className="text-xs text-muted-foreground mt-0.5">{provider.category}</p>
                )}
            </div>

            {/* Action */}
            <div className="w-full mt-1">
                <Dialog open={open} onOpenChange={handleOpenChange}>
                    <DialogTrigger asChild>
                        <Button
                            id={`connect-btn-${provider.name}`}
                            size="sm"
                            variant={isConnected ? 'ghost' : 'outline'}
                            className="w-full text-xs"
                        >
                            {isConnected ? 'Manage' : '+ New Connection'}
                        </Button>
                    </DialogTrigger>
                    <DialogContent className="sm:max-w-[480px] w-full">
                        <DialogHeader>
                            <DialogTitle>Connect {provider.displayName}</DialogTitle>
                            <DialogDescription>
                                Enter your OAuth credentials to establish a connection with this app.
                                Information is securely encrypted.
                            </DialogDescription>
                        </DialogHeader>
                        <DynamicAuthForm
                            provider={provider}
                            callbackUrl={callbackUrl}
                            isUpdate={isConnected}
                            defaultValues={useMemo(() => {
                                const coerced = coerceVendorParams(defaultCreds?.vendorParams, provider.uiSchema);
                                return {
                                    connectionName: connection?.displayName || provider.displayName,
                                    clientId: defaultCreds?.clientId || '',
                                    clientSecret: defaultCreds?.clientSecret || '',
                                    ...coerced,
                                };
                            }, [connection?.displayName, provider.displayName, defaultCreds, provider.uiSchema])}
                            onCancel={() => handleOpenChange(false)}
                            onSubmit={handleDynamicConnect}
                        />
                    </DialogContent>
                </Dialog>
            </div>
        </div>
    );
}
