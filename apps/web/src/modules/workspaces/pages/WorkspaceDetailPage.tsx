import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useParams, Link } from 'react-router-dom';
import { AppRoutes } from '@/shared/lib/auth/constants';
import { ArrowLeft, Building2, Loader2, Plus, Unlink } from 'lucide-react';
import { Button } from '@/shared/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/shared/components/ui/dialog';
import {
  getWorkspace,
  listWorkspaceConnections,
  listAvailableConnections,
  assignConnection,
  unassignConnection,
  type WorkspaceResponse,
  type WorkspaceConnectionResponse,
  type AvailableConnectionResponse,
} from '../api/workspaces.api';
import { EnvBadge } from '../components/EnvBadge';

export function WorkspaceDetailPage() {
  const { id } = useParams<{ id: string }>();

  const [workspace, setWorkspace] = useState<WorkspaceResponse | null>(null);
  const [wsLoading, setWsLoading] = useState(true);
  const [assignedConnections, setAssignedConnections] = useState<WorkspaceConnectionResponse[]>([]);
  const [allConnections, setAllConnections] = useState<AvailableConnectionResponse[]>([]);
  const [connectionsError, setConnectionsError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [assigning, setAssigning] = useState<string | null>(null);
  const [unassigningId, setUnassigningId] = useState<string | null>(null);

  const fetchSeqRef = useRef(0);
  const connSeqRef = useRef(0);

  const fetchWorkspace = useCallback(async () => {
    if (!id) return;
    const seq = ++fetchSeqRef.current;
    setWorkspace(null);
    setAssignedConnections([]);
    setWsLoading(true);
    try {
      const [ws, assigned] = await Promise.all([
        getWorkspace(id),
        listWorkspaceConnections(id),
      ]);
      if (seq !== fetchSeqRef.current) return;
      setWorkspace(ws);
      setAssignedConnections(assigned);
      setError(null);
    } catch (e: unknown) {
      if (seq !== fetchSeqRef.current) return;
      setError(e instanceof Error ? e.message : 'Failed to load workspace.');
    } finally {
      if (seq === fetchSeqRef.current) setWsLoading(false);
    }
  }, [id]);

  const fetchConnections = useCallback(async () => {
    if (!id) return;
    const seq = ++connSeqRef.current;
    try {
      const connections = await listAvailableConnections(id);
      if (seq !== connSeqRef.current) return;
      setAllConnections(connections);
      setConnectionsError(null);
    } catch (e: unknown) {
      if (seq !== connSeqRef.current) return;
      setConnectionsError(e instanceof Error ? e.message : 'Failed to load connections.');
    }
  }, [id]);

  useEffect(() => {
    void fetchWorkspace();
    void fetchConnections();
    // Capture ref objects (not values) so the cleanup mutates the same ref
    // regardless of when it runs — satisfies react-hooks/exhaustive-deps.
    const fetchRef = fetchSeqRef;
    const connRef = connSeqRef;
    return () => {
      fetchRef.current++;
      connRef.current++;
    };
  }, [fetchWorkspace, fetchConnections]);

  // allConnections is already filtered by the server: env-type matched + not yet assigned
  const unassignedConnections = allConnections;

  const handleAssign = async (connectionId: string) => {
    if (!id || assigning !== null || unassigningId !== null) return;
    setAssigning(connectionId);
    try {
      await assignConnection(id, connectionId);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to assign connection.');
      setAssigning(null);
      return;
    }

    // Assignment succeeded — clear any stale error and close the dialog
    setError(null);
    setDialogOpen(false);

    // Use the guarded callbacks so stale in-flight responses cannot overwrite state.
    try {
      await Promise.all([fetchWorkspace(), fetchConnections()]);
    } catch {
      setError('Connection assigned, but failed to refresh the list. Try reloading.');
    } finally {
      setAssigning(null);
    }
  };

  const handleUnassign = async (connectionId: string) => {
    if (!id || assigning !== null || unassigningId !== null) return;
    setUnassigningId(connectionId);
    try {
      await unassignConnection(id, connectionId);
      // Optimistic removal from the assigned list, then re-sync both lists via
      // the guarded callbacks so stale responses cannot overwrite state.
      setAssignedConnections((prev) => prev.filter((c) => c.id !== connectionId));
      await Promise.all([fetchWorkspace(), fetchConnections()]);
      setError(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to remove connection.');
    } finally {
      setUnassigningId(null);
    }
  };

  if (wsLoading) {
    return (
      <div className="flex items-center gap-2 p-6 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading workspace…
      </div>
    );
  }

  if (!workspace) {
    return <p className="p-6 text-destructive">{error ?? 'Workspace not found.'}</p>;
  }

  let dialogContent: ReactNode;
  if (connectionsError) {
    dialogContent = (
      <div className="text-center py-4 space-y-2">
        <p className="text-sm text-destructive">{connectionsError}</p>
        <Button size="sm" variant="outline" onClick={() => void fetchConnections()}>
          Retry
        </Button>
      </div>
    );
  } else if (unassignedConnections.length === 0) {
    const envLabel = workspace?.envType === 'SANDBOX' ? 'sandbox' : 'production';
    dialogContent = (
      <div className="text-center py-4 space-y-1">
        <p className="text-sm text-muted-foreground">
          No {envLabel} connections available.
        </p>
        <p className="text-xs text-muted-foreground">
          Create a {envLabel} connection in the Marketplace to assign it here.
        </p>
      </div>
    );
  } else {
    dialogContent = unassignedConnections.map((conn) => (
      <div
        key={conn.id}
        className="flex items-center justify-between rounded-md border px-3 py-2"
      >
        <div>
          <p className="text-sm font-medium">{conn.displayName}</p>
          <p className="text-xs text-muted-foreground">{conn.appName}</p>
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={assigning === conn.id}
          onClick={() => void handleAssign(conn.id)}
        >
          {assigning === conn.id && (
            <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
          )}
          Assign
        </Button>
      </div>
    ));
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Link to={AppRoutes.TENANT.WORKSPACES} aria-label="Back to workspaces" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <Building2 className="h-5 w-5 text-muted-foreground" />
        <h1 className="text-2xl font-semibold">{workspace.name}</h1>
        <EnvBadge envType={workspace.envType} />
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-medium">Connections</h2>
          <Button size="sm" onClick={() => setDialogOpen(true)}>
            <Plus className="mr-2 h-3.5 w-3.5" />
            Assign Connection
          </Button>
        </div>

        {assignedConnections.length === 0 ? (
          <div className="border rounded-lg p-8 text-center text-muted-foreground text-sm">
            No connections assigned. Click "Assign Connection" to add one.
          </div>
        ) : (
          <div className="divide-y border rounded-lg">
            {assignedConnections.map((conn) => (
              <div key={conn.id} className="flex items-center justify-between px-4 py-3">
                <div>
                  <p className="font-medium text-sm">{conn.displayName}</p>
                  <p className="text-xs text-muted-foreground">{conn.appName}</p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground"
                  disabled={unassigningId === conn.id}
                  onClick={() => void handleUnassign(conn.id)}
                >
                  {unassigningId === conn.id ? (
                    <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                  ) : (
                    <Unlink className="h-3.5 w-3.5 mr-1" />
                  )}
                  Remove
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Assign Connection</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 max-h-72 overflow-y-auto py-1">
            {dialogContent}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
