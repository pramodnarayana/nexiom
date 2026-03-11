import { useEffect, useState, useCallback, useMemo } from 'react';
import { Blocks, RefreshCw, Loader2 } from 'lucide-react';
import { Button } from '@/shared/components/ui/button';
import { ConnectAppCard } from '../components/ConnectAppCard';
import { useConnections } from '../hooks/useConnections';
import { listProviders, type ProviderResponse } from '../api/connections.api';

function useProviders() {
    const [providers, setProviders] = useState<ProviderResponse[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const data = await listProviders();
            setProviders(data);
            setError(null);
        } catch (e: unknown) {
            console.error(e);
            if (e instanceof Error) {
                setError(e.message);
            } else {
                setError('Failed to load integrations.');
            }
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void load();
    }, [load]);

    return { providers, loading, error };
}

export function ConnectionsPage() {
    const { loading: connectionsLoading, refresh, connect } = useConnections();
    const { providers, loading: providersLoading, error: providersError } = useProviders();
    const [search, setSearch] = useState('');

    // Load active connections on mount
    useEffect(() => {
        void refresh();
    }, [refresh]);



    // Filter providers by search
    const filtered = useMemo(() =>
        providers.filter(
            (p) =>
                p.displayName.toLowerCase().includes(search.toLowerCase()) ||
                p.category?.toLowerCase().includes(search.toLowerCase()),
        ),
        [providers, search]);

    const isLoading = providersLoading || connectionsLoading;

    return (
        <div className="space-y-8">
            {/* Page header */}
            <div className="flex items-center justify-between gap-4">
                <h2 className="text-2xl font-bold tracking-tight">Apps</h2>
                <Button
                    id="refresh-connections-btn"
                    variant="outline"
                    size="sm"
                    onClick={() => void refresh()}
                    disabled={connectionsLoading}
                >
                    <RefreshCw className={`h-4 w-4 mr-2 ${connectionsLoading ? 'animate-spin' : ''}`} />
                    Refresh
                </Button>
            </div>

            {/* Search */}
            <div className="relative">
                <input
                    id="provider-search"
                    type="text"
                    placeholder="Search apps..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="w-full rounded-lg border border-border bg-background px-4 py-2 pl-10 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
                <Blocks className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            </div>



            {/* Provider grid */}
            {providersError && (
                <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-center text-sm text-destructive">
                    <p className="font-semibold">Unable to load integrations</p>
                    <p>{providersError}</p>
                </div>
            )}
            {!providersError && isLoading && (
                <div className="flex items-center justify-center py-24">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
            )}
            {!providersError && !isLoading && filtered.length === 0 && (
                <div className="flex flex-col items-center justify-center py-24 gap-3 text-center">
                    <Blocks className="h-12 w-12 text-muted-foreground/50" />
                    <p className="text-muted-foreground">
                        {search ? `No integrations matching "${search}"` : 'No integrations available yet.'}
                    </p>
                </div>
            )}
            {!providersError && !isLoading && filtered.length > 0 && (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {filtered.map((provider) => (
                        <ConnectAppCard
                            key={provider.name}
                            provider={provider}
                            onConnect={connect}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}
