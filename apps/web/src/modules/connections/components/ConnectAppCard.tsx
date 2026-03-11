import { useState, useMemo } from 'react';
import { Plug2 } from 'lucide-react';
import { Button } from '@/shared/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from '@/shared/components/ui/dialog';
import { type ProviderResponse, type VendorParams } from '../api/connections.api';
import { DynamicAuthForm } from './DynamicAuthForm';

interface ConnectAppCardProps {
    provider: ProviderResponse;
    onConnect: (args: { providerName: string; clientId: string; clientSecret: string; displayName: string; vendorParams?: VendorParams }) => Promise<void>;
}



/**
 * ConnectAppCard — Activepieces-style provider card.
 *
 * Keeps it visual and minimal: large logo, display name, category, and
 * a single action button for creating a new connection.
 */
export function ConnectAppCard({ provider, onConnect }: Readonly<ConnectAppCardProps>) {
    const [open, setOpen] = useState(false);
    const [imgError, setImgError] = useState(false);

    const handleOpenChange = (isOpen: boolean) => {
        setOpen(isOpen);
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

    const [connectError, setConnectError] = useState<string | null>(null);

    const defaultFormValues = useMemo(() => ({
        connectionName: provider.displayName,
        clientId: '',
        clientSecret: '',
    }), [provider.displayName]);

    const handleDynamicConnect = async (data: {
        connectionName: string;
        clientId: string;
        clientSecret: string;
        vendorParams: VendorParams;
    }) => {
        setConnectError(null);
        try {
            await onConnect({
                providerName: provider.name,
                clientId: data.clientId,
                clientSecret: data.clientSecret,
                displayName: data.connectionName,
                vendorParams: data.vendorParams,
            });
            handleOpenChange(false);
        } catch (error: unknown) {
            setConnectError(error instanceof Error ? error.message : 'Failed to save connection details.');
        }
    };

    return (
        <div
            id={`connect-card-${provider.name}`}
            className="group relative flex flex-col items-center gap-3 rounded-2xl border border-border bg-card p-6 text-center shadow-sm transition-all duration-200 hover:shadow-md hover:border-primary/30 hover:-translate-y-0.5"
        >

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
                            variant="outline"
                            className="w-full text-xs"
                        >
                            + New Connection
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
                        {connectError && (
                            <div className="rounded-md bg-destructive/15 p-3 text-sm text-destructive border border-destructive/20 mt-2">
                                {connectError}
                            </div>
                        )}
                        <DynamicAuthForm
                            provider={provider}
                            callbackUrl={callbackUrl}
                            isUpdate={false}
                            defaultValues={defaultFormValues}
                            onCancel={() => handleOpenChange(false)}
                            onSubmit={handleDynamicConnect}
                        />
                    </DialogContent>
                </Dialog>
            </div>
        </div>
    );
}
