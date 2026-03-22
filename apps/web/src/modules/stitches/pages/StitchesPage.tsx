import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, GitMerge, Loader2, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/shared/components/ui/button';
import { Badge } from '@/shared/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/shared/components/ui/dialog';
import { getWorkspace, listWorkspaceConnections } from '@/modules/workspaces/api/workspaces.api';
import type { WorkspaceResponse, WorkspaceConnectionResponse } from '@/modules/workspaces/api/workspaces.api';
import {
  listStitches,
  createStitch,
  archiveStitch,
  type StitchResponse,
  type StitchStatus,
} from '../api/stitches.api';

// ── Helpers ───────────────────────────────────────────────────────────────────

function statusVariant(status: StitchStatus): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'ACTIVE') return 'default';
  if (status === 'PAUSED') return 'secondary';
  return 'outline';
}

function nextSyncLabel(stitch: StitchResponse): string {
  if (!stitch.scheduleEnabled) return 'Paused';
  if (!stitch.lastScheduledAt) return 'Not yet run';
  const next = new Date(stitch.lastScheduledAt).getTime() + stitch.syncIntervalMinutes * 60_000;
  const diffMin = Math.round((next - Date.now()) / 60_000);
  if (diffMin <= 0) return 'Due now';
  if (diffMin < 60) return `~${diffMin} min`;
  return `~${Math.round(diffMin / 60)} hr`;
}

// ── Create dialog ─────────────────────────────────────────────────────────────

interface CreateDialogProps {
  open: boolean;
  onClose: () => void;
  workspaceId: string;
  connections: WorkspaceConnectionResponse[];
  onCreate: (stitch: StitchResponse) => void;
}

function CreateStitchDialog({ open, onClose, workspaceId, connections, onCreate }: Readonly<CreateDialogProps>) {
  const [name, setName] = useState('');
  const [srcId, setSrcId] = useState('');
  const [destId, setDestId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setName('');
    setSrcId('');
    setDestId('');
    setError(null);
    setSubmitting(false);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleSubmit = async () => {
    // T023: sourceObject / targetObject collection not yet implemented.
    // This path is unreachable while the button is disabled, but kept for future use.
    if (!name.trim() || !srcId || !destId) {
      setError('All fields are required.');
      return;
    }
    if (srcId === destId) {
      setError('Source and destination connections must differ.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const stitch = await createStitch({ workspaceId, name: name.trim(), srcConnectionId: srcId, destConnectionId: destId });
      onCreate(stitch);
      reset();
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to create stitch.');
      setSubmitting(false);
    }
  };

  if (connections.length < 2) {
    return (
      <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>New Stitch</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground py-4">
            You need at least 2 connections assigned to this workspace to create a stitch.
            Go to the workspace detail page to assign connections first.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={handleClose}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>New Stitch</DialogTitle></DialogHeader>

        <div className="space-y-4 py-2">
          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="space-y-1">
            <label className="text-sm font-medium" htmlFor="stitch-name">Name</label>
            <input
              id="stitch-name"
              className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder="e.g. Salesforce → QuickBooks invoices"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium" htmlFor="src-conn">Source Connection</label>
            <select
              id="src-conn"
              className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              value={srcId}
              onChange={(e) => setSrcId(e.target.value)}
            >
              <option value="">Select source…</option>
              {connections.map((c) => (
                <option key={c.id} value={c.id} disabled={c.id === destId}>
                  {c.displayName} ({c.appName})
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium" htmlFor="dest-conn">Destination Connection</label>
            <select
              id="dest-conn"
              className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              value={destId}
              onChange={(e) => setDestId(e.target.value)}
            >
              <option value="">Select destination…</option>
              {connections.map((c) => (
                <option key={c.id} value={c.id} disabled={c.id === srcId}>
                  {c.displayName} ({c.appName})
                </option>
              ))}
            </select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={submitting}>Cancel</Button>
          {/* T023: field-mapping wizard not yet built — disable until sourceObject/targetObject can be collected */}
          <Button onClick={() => void handleSubmit()} disabled title="Field mapping wizard coming soon (T023)">
            Create Stitch
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function StitchesPage() {
  const { id: workspaceId } = useParams<{ id: string }>();

  const [workspace, setWorkspace] = useState<WorkspaceResponse | null>(null);
  const [connections, setConnections] = useState<WorkspaceConnectionResponse[]>([]);
  const [stitches, setStitches] = useState<StitchResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [archiving, setArchiving] = useState<string | null>(null);

  // Incremented on every new load; stale responses check their captured token
  // against the ref and discard state updates when superseded.
  const loadIdRef = useRef(0);

  const load = useCallback(async () => {
    if (!workspaceId) return;
    const myId = ++loadIdRef.current;
    // Reset state synchronously so we never show stale data during loading.
    setLoading(true);
    setWorkspace(null);
    setConnections([]);
    setStitches([]);
    setError(null);
    try {
      const [ws, conns, stitchList] = await Promise.all([
        getWorkspace(workspaceId),
        listWorkspaceConnections(workspaceId),
        listStitches(workspaceId),
      ]);
      if (myId !== loadIdRef.current) return; // superseded by a newer load
      setWorkspace(ws);
      setConnections(conns);
      setStitches(stitchList);
    } catch (e: unknown) {
      if (myId !== loadIdRef.current) return; // superseded — discard
      setWorkspace(null);
      setConnections([]);
      setStitches([]);
      setError(e instanceof Error ? e.message : 'Failed to load.');
    } finally {
      if (myId === loadIdRef.current) {
        setLoading(false);
      }
    }
  }, [workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleArchive = async (stitchId: string) => {
    if (archiving) return;
    setArchiving(stitchId);
    try {
      await archiveStitch(stitchId);
      setStitches((prev) => prev.filter((s) => s.id !== stitchId));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to archive stitch.');
    } finally {
      setArchiving(null);
    }
  };

  if (!workspaceId) {
    return (
      <div className="p-6 text-sm text-destructive">
        Invalid workspace URL.
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 p-6 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading stitches…
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link
          to={`/dashboard/workspaces/${workspaceId ?? ''}`}
          aria-label="Back to workspace"
          className="text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <GitMerge className="h-5 w-5 text-muted-foreground" />
        <h1 className="text-2xl font-semibold">
          Stitches
          {workspace && (
            <span className="ml-2 text-base font-normal text-muted-foreground">
              — {workspace.name}
            </span>
          )}
        </h1>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {/* Actions */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {stitches.length === 0
            ? 'No stitches yet. Create one to start syncing data between connections.'
            : `${stitches.length} stitch${stitches.length === 1 ? '' : 'es'}`}
        </p>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="mr-2 h-3.5 w-3.5" />
          New Stitch
        </Button>
      </div>

      {/* List */}
      {stitches.length === 0 ? (
        <div className="border rounded-lg p-12 text-center text-muted-foreground text-sm space-y-2">
          <GitMerge className="h-8 w-8 mx-auto opacity-30" />
          <p>No stitches yet.</p>
          <Button size="sm" variant="outline" onClick={() => setCreateOpen(true)}>
            <Plus className="mr-1 h-3.5 w-3.5" />
            New Stitch
          </Button>
        </div>
      ) : (
        <div className="divide-y border rounded-lg">
          {stitches.map((stitch) => (
            <div key={stitch.id} className="flex items-center justify-between px-4 py-3">
              <div className="space-y-0.5 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-medium text-sm truncate">{stitch.name}</p>
                  <Badge variant={statusVariant(stitch.status)} className="shrink-0 text-xs">
                    {stitch.status}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  Every {stitch.syncIntervalMinutes} min · Next sync: {nextSyncLabel(stitch)}
                </p>
              </div>
              <div className="flex items-center gap-2 ml-4">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground hover:text-destructive"
                  disabled={archiving === stitch.id}
                  onClick={() => void handleArchive(stitch.id)}
                  aria-label="Archive stitch"
                >
                  {archiving === stitch.id
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : <Trash2 className="h-3.5 w-3.5" />}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create dialog */}
      <CreateStitchDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        workspaceId={workspaceId}
        connections={connections}
        onCreate={(s) => setStitches((prev) => [s, ...prev])}
      />
    </div>
  );
}
