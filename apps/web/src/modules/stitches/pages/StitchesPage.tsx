import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { AppRoutes } from '@/shared/lib/auth/constants';
import { ArrowLeft, GitMerge, Loader2, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/shared/components/ui/button';
import { Badge } from '@/shared/components/ui/badge';
import { getWorkspace } from '@/modules/workspaces/api/workspaces.api';
import type { WorkspaceResponse } from '@/modules/workspaces/api/workspaces.api';
import {
  listStitches,
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

// ── Page ──────────────────────────────────────────────────────────────────────

export function StitchesPage() {
  const { id: workspaceId } = useParams<{ id: string }>();

  const [workspace, setWorkspace] = useState<WorkspaceResponse | null>(null);
  const [stitches, setStitches] = useState<StitchResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
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
    setStitches([]);
    setError(null);
    setArchiving(null);
    try {
      const [ws, stitchList] = await Promise.all([
        getWorkspace(workspaceId),
        listStitches(workspaceId),
      ]);
      if (myId !== loadIdRef.current) return; // superseded by a newer load
      setWorkspace(ws);
      setStitches(stitchList);
    } catch (e: unknown) {
      if (myId !== loadIdRef.current) return; // superseded — discard
      setWorkspace(null);
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
    // Capture the load token so a workspace navigation that fires a new load
    // while the archive request is in-flight doesn't mutate the next page's state.
    const token = loadIdRef.current;
    setArchiving(stitchId);
    try {
      await archiveStitch(stitchId);
      if (token !== loadIdRef.current) return;
      setStitches((prev) => prev.filter((s) => s.id !== stitchId));
    } catch (e: unknown) {
      if (token !== loadIdRef.current) return;
      setError(e instanceof Error ? e.message : 'Failed to archive stitch.');
    } finally {
      if (token === loadIdRef.current) {
        setArchiving(null);
      }
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
          to={`${AppRoutes.TENANT.WORKSPACES}/${workspaceId ?? ''}`}
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
      {!error && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            {stitches.length === 0
              ? 'No stitches yet. Create one to start syncing data between connections.'
              : `${stitches.length} ${stitches.length === 1 ? 'stitch' : 'stitches'}`}
          </p>
          {/* T023: field-mapping wizard not yet built — enabled when sourceObject/targetObject can be collected */}
          <Button size="sm" disabled title="Field mapping wizard coming soon (T023)">
            <Plus className="mr-2 h-3.5 w-3.5" />
            New Stitch
          </Button>
        </div>
      )}

      {/* List */}
      {!error && (stitches.length === 0 ? (
        <div className="border rounded-lg p-12 text-center text-muted-foreground text-sm space-y-2">
          <GitMerge className="h-8 w-8 mx-auto opacity-30" />
          <p>No stitches yet.</p>
          {/* T023: enabled when field-mapping wizard is implemented */}
          <Button size="sm" variant="outline" disabled title="Field mapping wizard coming soon (T023)">
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
                  disabled={archiving !== null}
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
      ))}
    </div>
  );
}
