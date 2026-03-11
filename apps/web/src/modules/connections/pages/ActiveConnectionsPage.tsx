import { useEffect, useMemo, useState } from 'react';
import { Blocks, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/shared/components/ui/button';
import { ActiveConnectionCard } from '../components/ActiveConnectionCard';
import { useConnections } from '../hooks/useConnections';
import { listProviders, type ProviderResponse } from '../api/connections.api';

function useProviders() {
    const [providers, setProviders] = useState<ProviderResponse[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const fetchProviders = () => {
        setLoading(true);
        listProviders()
            .then((data) => {
                setProviders(data);
                setError(null);
            })
            .catch((e: unknown) => {
                console.error(e);
                if (e instanceof Error) {
                    setError(e.message);
                } else {
                    setError('Failed to load integrations.');
                }
            })
            .finally(() => {
                setLoading(false);
            });
    };

    useEffect(() => {
        let isMounted = true;
        listProviders()
            .then((data) => {
                if (isMounted) {
                    setProviders(data);
                    setError(null);
                }
            })
            .catch((e: unknown) => {
                console.error(e);
                if (isMounted) {
                    if (e instanceof Error) {
                        setError(e.message);
                    } else {
                        setError('Failed to load integrations.');
                    }
                }
            })
            .finally(() => {
                if (isMounted) setLoading(false);
            });
        return () => {
            isMounted = false;
        };
    }, []);

    return { providers, loading, error, refreshProviders: fetchProviders };
}

export function ActiveConnectionsPage() {
    const { connections, loading: connectionsLoading, refresh } = useConnections();
    const { providers, loading: providersLoading, error: providersError, refreshProviders } = useProviders();
    const [search, setSearch] = useState('');

    useEffect(() => {
        void refresh();
    }, [refresh]);

    const handleRefreshAll = () => {
        refreshProviders();
        void refresh();
    };

    const activeConnections = useMemo(() => {
        return connections.filter(
            (c) =>
                c.displayName.toLowerCase().includes(search.toLowerCase()) ||
                c.appName.toLowerCase().includes(search.toLowerCase())
        );
    }, [connections, search]);

    const isLoadingConnections = connectionsLoading;
    const isRefreshing = providersLoading || connectionsLoading;

    return (
        <div className="space-y-8">
            <div className="flex items-center justify-between gap-4">
                <h2 className="text-2xl font-bold tracking-tight">Active Connections</h2>
                <Button
                    id="refresh-active-connections-btn"
                    variant="outline"
                    size="sm"
                    onClick={handleRefreshAll}
                    disabled={isRefreshing}
                >
                    <RefreshCw className={`h-4 w-4 mr-2 ${isRefreshing ? 'animate-spin' : ''}`} />
                    Refresh
                </Button>
            </div>

            <div className="relative">
                <input
                    id="connection-search"
                    aria-label="Search active connections"
                    type="text"
                    placeholder="Search active connections..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="w-full rounded-lg border border-border bg-background px-4 py-2 pl-10 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
                <Blocks aria-hidden="true" className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            </div>

            {providersError && (
                <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-center text-sm text-destructive">
                    <p className="font-semibold">Unable to load integrations</p>
                    <p>{providersError}</p>
                </div>
            )}

            {isLoadingConnections && (
                <div className="flex items-center justify-center py-24">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
            )}

            {!providersError && !isLoadingConnections && activeConnections.length === 0 && (
                <div className="flex flex-col items-center justify-center py-24 gap-3 text-center">
                    <Blocks className="h-12 w-12 text-muted-foreground/50" />
                    <p className="text-muted-foreground">
                        {search ? `No connections matching "${search}"` : "You don't have any active connections yet."}
                    </p>
                </div>
            )}

            {!providersError && !isLoadingConnections && activeConnections.length > 0 && (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {activeConnections.map((conn) => {
                        const provider = providers.find((p) => p.name === conn.appName);
                        return (
                            <ActiveConnectionCard
                                key={conn.id}
                                connection={conn}
                                provider={provider}
                            />
                        );
                    })}
                </div>
            )}
        </div>
    );
}
