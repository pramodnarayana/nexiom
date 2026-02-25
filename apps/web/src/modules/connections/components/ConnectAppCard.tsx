import { useState, useId } from 'react';
import { Plug2, Copy, Check } from 'lucide-react';
import { Button } from '@/shared/components/ui/button';
import { Badge } from '@/shared/components/ui/badge';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from '@/shared/components/ui/dialog';
import { Input } from '@/shared/components/ui/input';
import { Label } from '@/shared/components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/shared/components/ui/select';
import type { ProviderResponse, ActiveConnectionResponse } from '../api/connections.api';

interface ConnectAppCardProps {
    provider: ProviderResponse;
    connection?: ActiveConnectionResponse;
    onConnect: (args: { providerName: string; clientId: string; clientSecret?: string; displayName: string; env?: string }) => void;
}

const STATUS_BADGE: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
    ACTIVE: { label: 'Active', variant: 'default' },
    INACTIVE: { label: 'Inactive', variant: 'secondary' },
    EXPIRED: { label: 'Expired', variant: 'destructive' },
    REVOKED: { label: 'Revoked', variant: 'destructive' },
};

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
    const [connectionName, setConnectionName] = useState('');
    const [clientId, setClientId] = useState('');
    const [clientSecret, setClientSecret] = useState('');
    const [env, setEnv] = useState(provider.environments?.[0]?.name ?? 'production');
    const [copied, setCopied] = useState(false);
    const [imgError, setImgError] = useState(false);

    const connectionNameId = useId();
    const clientIdId = useId();
    const clientSecretId = useId();
    const envSelectId = useId();

    const handleOpenChange = (isOpen: boolean) => {
        setOpen(isOpen);
        if (isOpen && connection) {
            // Pre-fill the connection name from the existing connection
            setConnectionName(connection.displayName ?? '');
        }
        if (!isOpen) {
            setConnectionName('');
            setClientId('');
            setClientSecret('');
            setEnv(provider.environments?.[0]?.name ?? 'production');
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

    const handleCopy = () => {
        if (!callbackUrl) return;
        navigator.clipboard.writeText(callbackUrl).then(
            () => {
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
            },
            () => { /* silently ignore clipboard failure */ },
        );
    };

    const handleConnect = () => {
        if (!connectionName.trim() || !clientId || (!isConnected && !clientSecret)) return;
        onConnect({
            providerName: provider.name,
            clientId,
            clientSecret,
            displayName: connectionName.trim(),
            env,
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
                        <div className="grid gap-4 py-4">
                            <div className="grid grid-cols-4 items-center gap-4">
                                <Label htmlFor={connectionNameId} className="text-right">
                                    Name
                                </Label>
                                <Input
                                    id={connectionNameId}
                                    placeholder={`e.g. ${provider.displayName}`}
                                    value={connectionName}
                                    onChange={(e) => setConnectionName(e.target.value)}
                                    className="col-span-3"
                                />
                            </div>
                            <div className="grid grid-cols-4 items-center gap-4">
                                <Label htmlFor={clientIdId} className="text-right">
                                    Client ID
                                </Label>
                                <Input
                                    id={clientIdId}
                                    value={clientId}
                                    onChange={(e) => setClientId(e.target.value)}
                                    className="col-span-3"
                                />
                            </div>
                            <div className="grid grid-cols-4 items-center gap-4">
                                <Label htmlFor={clientSecretId} className="text-right">
                                    Client Secret
                                </Label>
                                <Input
                                    id={clientSecretId}
                                    type="password"
                                    value={clientSecret}
                                    onChange={(e) => setClientSecret(e.target.value)}
                                    className="col-span-3"
                                />
                            </div>
                            {provider.environments && provider.environments.length > 0 && (
                                <div className="grid grid-cols-4 items-center gap-4">
                                    <Label htmlFor={envSelectId} className="text-right">
                                        Environment
                                    </Label>
                                    <Select value={env} onValueChange={setEnv}>
                                        <SelectTrigger id={envSelectId} className="col-span-3">
                                            <SelectValue placeholder="Select environment" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {provider.environments.map((e) => (
                                                <SelectItem key={e.name} value={e.name}>
                                                    {e.displayName}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                            )}
                            <div className="grid grid-cols-4 items-center gap-4">
                                <Label className="text-right">
                                    Callback URL
                                </Label>
                                <div className="col-span-3 flex items-center relative gap-2">
                                    <Input
                                        value={callbackUrl}
                                        readOnly
                                        className="bg-muted font-mono text-xs pr-10 truncate"
                                        title="Copy this and paste it into the external app configuration"
                                    />
                                    <Button
                                        size="icon"
                                        variant="ghost"
                                        className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                                        onClick={handleCopy}
                                        type="button"
                                        title="Copy to clipboard"
                                    >
                                        {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4 text-muted-foreground" />}
                                    </Button>
                                </div>
                            </div>
                        </div>
                        <DialogFooter>
                            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
                                Cancel
                            </Button>
                            <Button type="button" onClick={handleConnect} disabled={!clientId || (!isConnected && !clientSecret)}>
                                {isConnected ? 'Reconnect' : 'Connect'}
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            </div>
        </div>
    );
}
