import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useParams, Link } from 'react-router-dom';
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
  assignConnection,
  unassignConnection,
  type WorkspaceResponse,
  type WorkspaceConnectionResponse,
} from '../api/workspaces.api';
import { EnvBadge } from '../components/EnvBadge';
import {
  listActiveConnections,
  type ActiveConnectionResponse,
} from '../../connections/api/connections.api';

export function WorkspaceDetailPage() {
  const { id } = useParams<{ id: string }>();

  const [workspace, setWorkspace] = useState<WorkspaceResponse | null>(null);
  const [wsLoading, setWsLoading] = useState(true);
  const [assignedConnections, setAssignedConnections] = useState<WorkspaceConnectionResponse[]>([]);
  const [allConnections, setAllConnections] = useState<ActiveConnectionResponse[]>([]);
  const [connectionsError, setConnectionsError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [assigning, setAssigning] = useState<string | null>(null);

  const fetchWorkspace = useCallback(async () => {
    if (!id) return;
    setWsLoading(true);
    try {
      const [ws, assigned] = await Promise.all([
        getWorkspace(id),
        listWorkspaceConnections(id),
      ]);
      setWorkspace(ws);
      setAssignedConnections(assigned);
      setError(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load workspace.');
    } finally {
      setWsLoading(false);
    }
  }, [id]);

  const fetchConnections = useCallback(async () => {
    try {
      setAllConnections(await listActiveConnections());
      setConnectionsError(null);
    } catch (e: unknown) {
      setConnectionsError(e instanceof Error ? e.message : 'Failed to load connections.');
    }
  }, []);

  useEffect(() => {
    void fetchWorkspace();
    void fetchConnections();
  }, [fetchWorkspace, fetchConnections]);

  const assignedIds = new Set(assignedConnections.map((c) => c.id));
  const unassignedConnections = allConnections.filter((c) => !assignedIds.has(c.id));

  const handleAssign = async (connectionId: string) => {
    if (!id) return;
    setAssigning(connectionId);
    try {
      await assignConnection(id, connectionId);
      setAssignedConnections(await listWorkspaceConnections(id));
      setDialogOpen(false);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to assign connection.');
    } finally {
      setAssigning(null);
    }
  };

  const handleUnassign = async (connectionId: string) => {
    if (!id) return;
    try {
      await unassignConnection(id, connectionId);
      setAssignedConnections((prev) => prev.filter((c) => c.id !== connectionId));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to remove connection.');
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
    dialogContent = (
      <p className="text-sm text-muted-foreground text-center py-4">
        All connections are already assigned.
      </p>
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
        <Link to="/dashboard/workspaces" className="text-muted-foreground hover:text-foreground">
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
                  onClick={() => void handleUnassign(conn.id)}
                >
                  <Unlink className="h-3.5 w-3.5 mr-1" />
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
